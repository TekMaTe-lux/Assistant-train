#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

MARK = "LB_COMMUNITY_SIGNAL_DIALOG_EDIT_V2"
DEFAULT_ROOT = "/opt/labetaillere-map-v2-src"


def atomic_write(path: Path, data: bytes) -> None:
    st = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, st.st_mode & 0o7777)
        if os.geteuid() == 0:
            os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def node_check(text: str) -> None:
    if not shutil.which("node"):
        raise RuntimeError("node absent : impossible de vérifier le JavaScript")
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(text)
        tmp = f.name
    try:
        p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True, timeout=20)
        if p.returncode:
            raise RuntimeError("JavaScript invalide après patch : " + p.stderr.strip())
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def replace_once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: attendu 1 occurrence, trouvé {n}")
    return text.replace(old, new, 1)


def patch_dialog(text: str) -> str:
    if MARK in text:
        return text

    required = [
        "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__",
        "data-lb-signal-delete",
        "async function removeOwn(signalId)",
        "async function vote(signalId, value)",
        "LB_COMMUNITY_SIGNAL_DIALOG_V1",
    ]
    for token in required:
        if token not in text:
            raise RuntimeError(f"dialogue V1 inattendu : marqueur absent {token}")

    text = replace_once(
        text,
        "  const SIGNAL_TTL_MS = 45 * 60 * 1000;\n",
        "  const SIGNAL_TTL_MS = 45 * 60 * 1000;\n  // LB_COMMUNITY_SIGNAL_DIALOG_EDIT_V2 — l'auteur peut corriger son retard sans toucher au backend.\n",
        "marqueur V2",
    )

    old_owner = """      const actions = owner
        ? `<button type="button" class="lb-signal-delete" data-lb-signal-delete="${htmlEscape(signal.id)}">Supprimer mon signalement</button>`
        : `<button type="button" data-lb-signal-vote="1" data-signal-id="${htmlEscape(signal.id)}" class="${signal.myVote === 1 ? 'is-active' : ''}">👍 Je confirme</button>
           <button type="button" data-lb-signal-vote="-1" data-signal-id="${htmlEscape(signal.id)}" class="${signal.myVote === -1 ? 'is-active' : ''}">👎 Je ne constate pas</button>`;"""
    new_owner = """      const actions = owner
        ? `<button type="button" class="lb-signal-edit" data-lb-signal-edit="${htmlEscape(signal.id)}">Modifier mon signalement</button>
           <button type="button" class="lb-signal-delete" data-lb-signal-delete="${htmlEscape(signal.id)}">Supprimer</button>`
        : `<button type="button" data-lb-signal-vote="1" data-signal-id="${htmlEscape(signal.id)}" class="${signal.myVote === 1 ? 'is-active' : ''}">👍 Je confirme</button>
           <button type="button" data-lb-signal-vote="-1" data-signal-id="${htmlEscape(signal.id)}" class="${signal.myVote === -1 ? 'is-active' : ''}">👎 Je ne constate pas</button>`;"""
    text = replace_once(text, old_owner, new_owner, "actions propriétaire")

    css_old = "      .lb-signal-actions button.lb-signal-delete{border-color:rgba(255,115,115,.35);background:rgba(92,25,31,.45);color:#ffd8d8}\n"
    css_new = css_old + """      .lb-signal-actions button.lb-signal-edit{border-color:rgba(0,234,255,.38);background:rgba(5,42,61,.82);color:#e9fdff}
      .lb-signal-editor{margin-top:10px;padding:10px;border:1px solid rgba(0,234,255,.22);border-radius:11px;background:rgba(3,22,36,.76)}
      .lb-signal-editor-label{display:block;margin-bottom:6px;color:#c7dfe7;font-size:10px;font-weight:850}
      .lb-signal-editor-row{display:flex;align-items:center;gap:7px}
      .lb-signal-editor-input{box-sizing:border-box;width:92px;min-height:40px;padding:7px 9px;border:1px solid rgba(183,140,255,.48);border-radius:9px;background:rgba(12,20,35,.92);color:#fff;font-size:16px;font-weight:950;text-align:center;outline:none}
      .lb-signal-editor-input:focus{border-color:#8ef8ff;box-shadow:0 0 0 2px rgba(0,234,255,.10)}
      .lb-signal-editor-unit{color:#b7ccd5;font-size:11px;font-weight:850}
      .lb-signal-editor-note{margin-top:6px;color:#8da8b4;font-size:9px;line-height:1.3}
      .lb-signal-editor-actions{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap}
      .lb-signal-editor-actions button{min-height:38px;flex:1 1 130px;padding:8px 10px;border-radius:9px;border:1px solid rgba(0,234,255,.28);background:rgba(5,31,51,.92);color:#effdff;font-size:10.5px;font-weight:900;cursor:pointer}
      .lb-signal-editor-actions .lb-signal-edit-save{border-color:rgba(0,234,255,.54);background:rgba(4,52,69,.94)}
"""
    text = replace_once(text, css_old, css_new, "styles édition")

    mobile_old = "        .lb-signal-actions button{min-height:44px;font-size:11.5px}\n"
    mobile_new = mobile_old + """        .lb-signal-editor-input{min-height:44px;font-size:17px}
        .lb-signal-editor-actions button{min-height:44px;font-size:11.5px}
"""
    text = replace_once(text, mobile_old, mobile_new, "styles édition mobile")

    insertion_point = "  async function removeOwn(signalId){\n"
    edit_code = r'''  function showEdit(signalId){
    if (busy) return;
    const signal = currentSignals.find((x) => x.id === String(signalId)) || null;
    if (!signal || !isOwner(signal)) return;

    const card = Array.from(bodyNode().querySelectorAll('[data-signal-card]'))
      .find((node) => String(node.getAttribute('data-signal-card') || '') === String(signal.id));
    if (!card) return;

    bodyNode().querySelectorAll('.lb-signal-editor').forEach((node) => node.remove());
    const editor = document.createElement('div');
    editor.className = 'lb-signal-editor';
    editor.dataset.signalEditor = signal.id;
    editor.innerHTML = `
      <label class="lb-signal-editor-label" for="lb-signal-delay-edit-${htmlEscape(signal.id)}">Corriger le retard signalé</label>
      <div class="lb-signal-editor-row">
        <input id="lb-signal-delay-edit-${htmlEscape(signal.id)}" class="lb-signal-editor-input" type="number" inputmode="numeric" min="1" max="180" step="1" value="${signal.delayMin}" aria-label="Nouveau retard en minutes">
        <span class="lb-signal-editor-unit">minutes</span>
      </div>
      <div class="lb-signal-editor-note">La gare reste ${htmlEscape(signal.station || 'inchangée')}. Les votes précédents sont remis à zéro car la valeur du retard change.</div>
      <div class="lb-signal-editor-actions">
        <button type="button" data-lb-signal-edit-cancel="${htmlEscape(signal.id)}">Annuler</button>
        <button type="button" class="lb-signal-edit-save" data-lb-signal-edit-save="${htmlEscape(signal.id)}">Enregistrer la modification</button>
      </div>`;
    card.appendChild(editor);
    const input = editor.querySelector('.lb-signal-editor-input');
    input?.focus?.();
    input?.select?.();
  }

  function closeEdit(signalId = ''){
    const wanted = String(signalId || '');
    bodyNode().querySelectorAll('.lb-signal-editor').forEach((node) => {
      if (!wanted || String(node.dataset.signalEditor || '') === wanted) node.remove();
    });
  }

  async function replaceOwnDelay(signalId, newDelayRaw){
    if (busy) return;
    const signal = currentSignals.find((x) => x.id === String(signalId)) || null;
    if (!signal || !isOwner(signal)) return;

    const newDelay = Math.round(Number(newDelayRaw) || 0);
    if (!(newDelay >= 1 && newDelay <= 180)) {
      renderSignals('Le retard doit être compris entre 1 et 180 minutes.');
      return;
    }
    if (newDelay === signal.delayMin) {
      closeEdit(signal.id);
      return;
    }

    busy = true;
    let newId = '';
    try {
      // Le backend actuel n'expose pas PATCH/PUT. On remplace donc proprement :
      // 1) création du nouveau signal ; 2) suppression de l'ancien.
      // L'ancien reste intact tant que la création n'a pas réussi.
      const createResponse = await fetch('/api/comments', {
        method:'POST',
        credentials:'include',
        cache:'no-store',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({
          message:`[RETARD] ${signal.trainNumber} [${signal.station || ''}] — +${newDelay} min`,
          train_number:signal.trainNumber,
          scope:'signals',
          station:signal.station || null,
          signal_type:'retard',
          delay_min:newDelay
        })
      });
      const createData = await createResponse.json().catch(() => ({}));
      if (createResponse.status === 401 || createResponse.status === 403) {
        requestAuthentication();
        throw new Error(createData?.error || 'Connectez-vous pour modifier votre signalement.');
      }
      if (!createResponse.ok) throw new Error(createData?.error || `Création impossible (HTTP ${createResponse.status}).`);
      newId = String(createData?.id ?? '').trim();
      if (!newId) throw new Error('Le nouveau signalement a été créé sans identifiant exploitable.');

      const deleteResponse = await fetch(`/api/comments/${encodeURIComponent(signal.id)}`, {
        method:'DELETE', credentials:'include', cache:'no-store', headers:{'Accept':'application/json'}
      });
      const deleteData = await deleteResponse.json().catch(() => ({}));
      if (!deleteResponse.ok) {
        let rollbackOk = false;
        try {
          const rollback = await fetch(`/api/comments/${encodeURIComponent(newId)}`, {
            method:'DELETE', credentials:'include', cache:'no-store', headers:{'Accept':'application/json'}
          });
          rollbackOk = rollback.ok;
        } catch(_) {}
        if (deleteResponse.status === 401 || deleteResponse.status === 403) requestAuthentication();
        throw new Error(
          rollbackOk
            ? (deleteData?.error || 'Modification annulée : l’ancien signalement n’a pas pu être remplacé.')
            : 'Modification incomplète : rechargez la fiche avant toute nouvelle action.'
        );
      }

      currentHint = { station:signal.station || '', delay:newDelay };
      await refreshDialog();
      notifyParentChanged();
      window.setTimeout(notifyParentChanged, 250);
      window.setTimeout(notifyParentChanged, 1000);
    } catch (error) {
      try { await refreshDialog(); } catch(_) {}
      renderSignals(error?.message || 'Modification impossible.');
    } finally {
      busy = false;
    }
  }

'''
    if text.count(insertion_point) != 1:
        raise RuntimeError(f"point insertion fonctions édition: attendu 1, trouvé {text.count(insertion_point)}")
    text = text.replace(insertion_point, edit_code + insertion_point, 1)

    click_old = """  document.addEventListener('click', (event) => {
    const deleteButton = event.target?.closest?.('[data-lb-signal-delete]');
"""
    click_new = """  document.addEventListener('click', (event) => {
    const editButton = event.target?.closest?.('[data-lb-signal-edit]');
    if (editButton) {
      event.preventDefault(); event.stopPropagation();
      showEdit(editButton.dataset.lbSignalEdit);
      return;
    }

    const editCancel = event.target?.closest?.('[data-lb-signal-edit-cancel]');
    if (editCancel) {
      event.preventDefault(); event.stopPropagation();
      closeEdit(editCancel.dataset.lbSignalEditCancel);
      return;
    }

    const editSave = event.target?.closest?.('[data-lb-signal-edit-save]');
    if (editSave) {
      event.preventDefault(); event.stopPropagation();
      const id = String(editSave.dataset.lbSignalEditSave || '');
      const editor = editSave.closest('.lb-signal-editor');
      const input = editor?.querySelector('.lb-signal-editor-input');
      replaceOwnDelay(id, input?.value).catch(() => {});
      return;
    }

    const deleteButton = event.target?.closest?.('[data-lb-signal-delete]');
"""
    text = replace_once(text, click_old, click_new, "gestion clics édition")

    key_old = """  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shell && !shell.hidden) closeDialog();
  });
"""
    key_new = """  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target?.classList?.contains('lb-signal-editor-input')) {
      event.preventDefault();
      const editor = event.target.closest('.lb-signal-editor');
      const id = String(editor?.dataset?.signalEditor || '');
      if (id) replaceOwnDelay(id, event.target.value).catch(() => {});
      return;
    }
    if (event.key === 'Escape' && shell && !shell.hidden) {
      const editor = event.target?.closest?.('.lb-signal-editor');
      if (editor) { closeEdit(editor.dataset.signalEditor); return; }
      closeDialog();
    }
  });
"""
    text = replace_once(text, key_old, key_new, "gestion clavier édition")

    checks = [
        MARK,
        "Modifier mon signalement",
        "data-lb-signal-edit-save",
        "async function replaceOwnDelay",
        "method:'POST'",
        "method:'DELETE'",
        "👍 Je confirme",
        "👎 Je ne constate pas",
        "Supprimer</button>",
        "window.__LB_COMMUNITY_SIGNAL_DIALOG_V1__",
    ]
    for token in checks:
        if token not in text:
            raise RuntimeError(f"contrôle final absent : {token}")

    return text


def patch_core(text: str, version: str) -> str:
    pattern = re.compile(r'(lb-community-signal-dialog-v1\.js\?v=)[^"\']+')
    new, n = pattern.subn(r'\g<1>' + version, text)
    if n != 1:
        raise RuntimeError(f"core : référence dialogue attendue 1 fois, trouvée {n}")
    return new


def main() -> None:
    ap = argparse.ArgumentParser(description="Ajoute Modifier mon signalement au dialogue communautaire V1")
    ap.add_argument("--root", default=os.environ.get("LB_MAP_ROOT", DEFAULT_ROOT))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    public = Path(args.root) / "map-v2/public"
    dialog = public / "assets/lb-community-signal-dialog-v1.js"
    core = public / "carte-core-preview.html"
    for p in (dialog, core):
        if not p.is_file():
            raise RuntimeError(f"fichier absent : {p}")

    before_dialog = dialog.read_bytes()
    before_core = core.read_bytes()
    dialog_text = before_dialog.decode("utf-8")
    core_text = before_core.decode("utf-8")

    if "__LB_COMMUNITY_SIGNAL_DIALOG_V1__" not in dialog_text:
        raise RuntimeError("dialogue signal par signal V1 absent : refus de modifier")
    if "lb-community-signal-dialog-v1.js?v=" not in core_text:
        raise RuntimeError("dialogue V1 non référencé dans le core")

    after_dialog = patch_dialog(dialog_text)
    version = "20260910-signal-dialog-edit-v2"
    after_core = patch_core(core_text, version)
    node_check(after_dialog)

    print("DIALOGUE SIGNALEMENT — EDITION V2 VERIFIEE :")
    print("  ✓ auteur : 'Modifier mon signalement' + 'Supprimer'")
    print("  ✓ modification limitée au retard (gare conservée)")
    print("  ✓ nouveau signal créé avant suppression de l'ancien")
    print("  ✓ rollback automatique du nouveau si l'ancien ne peut pas être supprimé")
    print("  ✓ votes précédents remis à zéro après changement de valeur")
    print("  ✓ votes des autres voyageurs inchangés dans l'interface")
    print("  ✓ backend / base / GTFS / routage non modifiés")
    print("  ✓ JavaScript validé avec node --check")

    after_dialog_b = after_dialog.encode("utf-8")
    after_core_b = after_core.encode("utf-8")

    if after_dialog_b == before_dialog and after_core_b == before_core:
        print("Correctif déjà installé. Aucun changement.")
        return
    if not args.apply:
        print("SIMULATION OK — ajouter --apply pour installer.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = Path(args.root) / "map-v2/backups" / ("community-signal-dialog-edit-v2-" + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(dialog, backup / dialog.name)
    shutil.copy2(core, backup / core.name)

    changed: list[tuple[Path, bytes]] = []
    try:
        if dialog.read_bytes() != before_dialog or core.read_bytes() != before_core:
            raise RuntimeError("modification concurrente détectée : aucun fichier écrit")
        atomic_write(dialog, after_dialog_b)
        changed.append((dialog, before_dialog))
        atomic_write(core, after_core_b)
        changed.append((core, before_core))
    except BaseException:
        for path, data in reversed(changed):
            atomic_write(path, data)
        print("ERREUR : rollback automatique effectué.")
        raise

    print("INSTALLÉ — édition du retard communautaire uniquement.")
    print("Sauvegarde :", backup)
    print("Recharge la carte puis clique sur ton (+N min).")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        raise SystemExit("ARRÊT : " + str(e))
