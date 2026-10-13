/* Lightweight single departure time compatible with the existing GTFS slider search. */
(()=>{
'use strict';
const input=document.getElementById('lbTripDepartureTime'),date=document.getElementById('trainDate'),from=document.getElementById('timeFrom'),to=document.getElementById('timeTo');
if(!input||!date||!from||!to)return;
const pad=n=>String(n).padStart(2,'0');
let extraWindow=0;
const MAX_WINDOW=12*60;
function localParts(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 return Object.fromEntries(parts.map(x=>[x.type,x.value]));
}
function apply(){
 if(!/^\d\d:\d\d$/.test(input.value))return;
 const [h,m]=input.value.split(':').map(Number);
 const start=h*60+m,end=Math.min(1439,start+300+extraWindow);
 const fmt=n=>pad(Math.floor(n/60))+':'+pad(n%60);
 from.value=fmt(start);to.value=fmt(end);
 from.dispatchEvent(new Event('change',{bubbles:true}));
 to.dispatchEvent(new Event('change',{bubbles:true}));
 const slider=document.getElementById('timeSlider');
 if(slider?.noUiSlider){try{slider.noUiSlider.set([start,end]);}catch(_){}}
 const a=document.getElementById('timeFromLabel'),b=document.getElementById('timeToLabel');
 if(a)a.textContent=fmt(start);
 if(b)b.textContent=fmt(end);
}
function preset(){
 const p=localParts(),today=p.year+'-'+p.month+'-'+p.day;
 if(!date.value) date.value=today;
 input.value=p.hour+':'+p.minute;
 apply();
}
input.addEventListener('input',()=>{extraWindow=0;apply();});
input.addEventListener('change',apply);
date.addEventListener('change',()=>{extraWindow=0;if(!input.dataset.userChanged) {const p=localParts();input.value=p.hour+':'+p.minute;}apply();});
input.addEventListener('change',()=>{input.dataset.userChanged='1';});
document.getElementById('btnProposer')?.addEventListener('pointerdown',apply,{capture:true});
// More trains: reuse exactly the existing search/selection handler.
const proposals=document.getElementById('proposalSection');
const action=document.getElementById('btnProposer');
if(proposals&&action){
 const control=document.createElement('div');
 control.className='lb-more-trains';
 control.innerHTML='<span>Besoin de plus de trains ?</span><button type="button" data-add="120">+2 h</button><button type="button" data-add="240">+4 h</button>';
 proposals.appendChild(control);
 control.addEventListener('click',event=>{
   const button=event.target.closest('button[data-add]');
   if(!button)return;
   const increment=Number(button.dataset.add)||0;
   const current=Number(input.value.slice(0,2))*60+Number(input.value.slice(3,5));
   const available=Math.max(0,1439-current-300-extraWindow);
   if(available<=0){control.querySelector('span').textContent='Fin de journée atteinte';return;}
   extraWindow=Math.min(MAX_WINDOW,extraWindow+Math.min(increment,available));
   apply();
   control.querySelector('span').textContent='Période étendue jusqu’à '+to.value;
   action.click();
 });
}

preset();
// Existing timetable UI initializes asynchronously; resync once it is ready.
window.addEventListener('load',()=>{if(!input.dataset.userChanged)apply();},{once:true});
})();
