(()=>{
  'use strict';
  const REMOTE='https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip';
  const LOCAL=new URL('data/france-gtfs/sncf-current.zip',document.baseURI).href;
  const nativeFetch=window.fetch.bind(window);

  window.fetch=(input,init)=>{
    const url=typeof input==='string' ? input : (input&&input.url)||'';
    if(url===REMOTE || url.includes('/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip')){
      const nextInit={...(init||{})};
      delete nextInit.mode;
      return nativeFetch(LOCAL,nextInit);
    }
    return nativeFetch(input,init);
  };
})();
