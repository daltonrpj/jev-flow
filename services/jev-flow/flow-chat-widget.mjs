export function buildFlowChatWidget() {
  return `
<style>
#flowChatDrawer[hidden],#flowChatFab[hidden]{display:none!important}
#flowChatFab{position:fixed;right:22px;bottom:22px;z-index:80;border:1px solid #62b98b;background:linear-gradient(135deg,#12865c,#155f6c);color:white;border-radius:99px;padding:13px 19px;font:750 13px system-ui;box-shadow:0 12px 38px #0009;cursor:pointer}
#flowChatDrawer{position:fixed;right:16px;bottom:16px;z-index:81;width:min(440px,calc(100vw - 30px));height:min(650px,calc(100vh - 30px));display:flex;flex-direction:column;background:#0c171b;border:1px solid #32515b;border-radius:18px;box-shadow:0 24px 75px #000d;overflow:hidden;color:#edf8f7;font:13px/1.5 system-ui}
#flowChatDrawer button{cursor:pointer}#flowChatHeader{display:flex;align-items:center;gap:10px;padding:15px;border-bottom:1px solid #284047;background:#12252a}#flowChatHeader b{font-size:14px}#flowChatHeader small{display:block;color:#9db7ba;font-size:11px}#flowChatClose{margin-left:auto;border:0;background:none;color:#d6e8e8;font-size:19px}
#flowChatLog{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}#flowChatLog div{max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:12px;padding:9px 12px;background:#172930;border:1px solid #29414a}#flowChatLog .mine{align-self:flex-end;background:#174a37;border-color:#2e805c}
#flowChatDraft{margin:0 13px 8px;padding:12px;background:#13272c;border:1px solid #36535b;border-radius:12px}#flowChatDraft strong{display:block}#flowChatDraft small{color:#a7bdc2}#flowChatDraft button,#flowChatSend{background:#20a56f;color:#fff;border:0;border-radius:9px;padding:9px 13px;font-weight:800}#flowChatDraft button{margin-top:8px}#flowChatComposer{display:flex;gap:8px;padding:12px;border-top:1px solid #284047}#flowChatInput{flex:1;resize:none;background:#081418;color:#edf8f7;border:1px solid #3a555e;border-radius:10px;padding:9px;font:13px system-ui}#flowChatSend{align-self:flex-end}#flowChatSend:disabled{opacity:.5}
</style>
<button type="button" id="flowChatFab" aria-controls="flowChatDrawer" aria-expanded="false">✦ Create a flow by chatting</button>
<section id="flowChatDrawer" role="dialog" aria-label="Flow designer" hidden>
  <div id="flowChatHeader"><div><b>Flow designer</b><small>Describe, review, refine, then save</small></div><button type="button" id="flowChatClose" aria-label="Close designer">×</button></div>
  <div id="flowChatLog" aria-live="polite"></div>
  <div id="flowChatDraft" hidden></div>
  <div id="flowChatComposer"><textarea id="flowChatInput" rows="2" maxlength="4000" placeholder="Example: When an order arrives by webhook, classify urgency, route errors to review, and log the outcome."></textarea><button type="button" id="flowChatSend">Send</button></div>
</section>
<script>
(function(){
  var fab=document.getElementById('flowChatFab'),drawer=document.getElementById('flowChatDrawer');
  var log=document.getElementById('flowChatLog'),input=document.getElementById('flowChatInput');
  var draftBox=document.getElementById('flowChatDraft'),send=document.getElementById('flowChatSend');
  var messages=[],draft=null,validation=null;
  function bubble(value,mine){var item=document.createElement('div');item.textContent=value;if(mine)item.className='mine';log.appendChild(item);log.scrollTop=log.scrollHeight;return item;}
  function open(){drawer.hidden=false;fab.hidden=true;fab.setAttribute('aria-expanded','true');if(!messages.length)bubble('Describe the input, the decision, and the desired outcome. I will create a draft you can inspect and refine before saving.',false);input.focus();}
  function close(){drawer.hidden=true;fab.hidden=false;fab.setAttribute('aria-expanded','false');fab.focus();}
  fab.addEventListener('click',open);document.getElementById('flowChatClose').addEventListener('click',close);
  function showDraft(){draftBox.replaceChildren();draftBox.hidden=!draft;if(!draft)return;
    var title=document.createElement('strong');title.textContent=draft.name||draft.id||'Draft';draftBox.appendChild(title);
    var info=document.createElement('small');info.textContent=Object.keys(draft.nodes||{}).length+' nodes · '+(validation&&validation.ok?'Valid structure':'Needs revision');draftBox.appendChild(info);
    if(validation&&validation.ok){var save=document.createElement('button');save.type='button';save.textContent='Save and open canvas';save.addEventListener('click',saveDraft);draftBox.appendChild(save);}
    else{var errors=document.createElement('small');errors.style.display='block';errors.textContent=(validation&&validation.errors||[]).slice(0,3).map(function(x){return x.codigo+': '+x.msg;}).join('; ');draftBox.appendChild(errors);}
  }
  async function saveDraft(){try{var response=await fetch('/api/jev/flows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({flow:draft})});var data=await response.json();if(!response.ok)throw new Error(data.error||data.validacao&&JSON.stringify(data.validacao.errors)||'Save failed');location.href='/jev/flows/'+encodeURIComponent(draft.id)+'/demo';}catch(error){bubble('Save failed: '+error.message,false);}}
  async function submit(){var content=input.value.trim();if(!content)return;input.value='';messages.push({role:'user',content:content});bubble(content,true);var pending=bubble('Designing and validating…',false);send.disabled=true;
    try{var response=await fetch('/api/jev/flows/design-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mensagens:messages,base_flow:draft})});var data=await response.json();if(!response.ok)throw new Error(data.error||'Design failed');pending.textContent=data.fala||'Draft returned';messages.push({role:'designer',content:data.fala||''});draft=data.rascunho||null;validation=data.validacao||null;showDraft();}
    catch(error){pending.textContent='Design failed: '+error.message;}finally{send.disabled=false;input.focus();}
  }
  send.addEventListener('click',submit);input.addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit();}});
})();
</script>`;
}
