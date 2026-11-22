(function(){
  const main=document.querySelector('main');
  const panels=[...document.querySelectorAll('.advanced-panel')];
  if(!main||!panels.length)return;
  const details=document.createElement('details');
  details.className='advanced-tools';
  const summary=document.createElement('summary');
  summary.innerHTML='<span><strong>Advanced tools</strong><small>Transaction signing, payment requests, UTXOs and technical diagnostics</small></span><b aria-hidden="true">+</b>';
  details.append(summary);
  panels.forEach(panel=>details.append(panel));
  main.append(details);
})();
