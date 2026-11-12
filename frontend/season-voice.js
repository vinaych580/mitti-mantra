(() => {
  'use strict';
  const numbers = {
    zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,
    'शून्य':0,'एक':1,'दो':2,'तीन':3,'चार':4,'पांच':5,'पाँच':5,'छह':6,'सात':7,'आठ':8,'नौ':9,'दस':10,'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,'बीस':20,'तीस':30,'चालीस':40,'पचास':50,
    'సున్నా':0,'ఒకటి':1,'ఒక':1,'రెండు':2,'మూడు':3,'నాలుగు':4,'ఐదు':5,'ఆరు':6,'ఏడు':7,'ఎనిమిది':8,'తొమ్మిది':9,'పది':10,'పదకొండు':11,'పన్నెండు':12,'పదమూడు':13,'పద్నాలుగు':14,'పదిహేను':15,'ఇరవై':20,'ముప్పై':30,'నలభై':40,'యాభై':50
  };
  function parseNumber(s) {
    s=s.toLowerCase().replace(/[०-९]/g,c=>String(c.charCodeAt(0)-0x966)).replace(/[౦-౯]/g,c=>String(c.charCodeAt(0)-0xc66))
      .replace(/,/g,'').replace(/₹/g,'').trim();
    // Only known units are removed; ambiguous or contradictory phrases fail.
    const tokens=s.split(/\s+/).filter(w=>!['acre','acres','rupees','rupee','एकड़','एकड़','रुपये','रुपए','ఎకరాలు','ఎకరాల','ఎకరం','రూపాయలు','రూపాయల'].includes(w));
    const normalized=tokens.map(w=>Object.hasOwn(numbers,w)?String(numbers[w]):w).join(' ')
      .replace(/(?:point|पॉइंट|दशमलव|పాయింట్)\s+(\d)/g,'.$1').replace(/(\d)\s+\./g,'$1.');
    if(/^\d+(?:\.\d+)?$/.test(normalized))return Number(normalized);
    const scale=normalized.match(/^(\d+(?:\.\d+)?)\s+(thousand|हजार|हज़ार|వేలు|వేల|lakh|लाख|లక్షలు|లక్ష)$/);
    if(scale)return Number(scale[1])*(/thousand|हजार|हज़ार|వేలు|వేల/.test(scale[2])?1000:100000);
    return null;
  }
  const aliases={telangana_medak:['मेडक','మెదక్'],ap_guntur:['गुंटूर','గుంటూరు'],mh_nashik:['नाशिक','నాసిక్'],mh_pune:['पुणे','పుణే'],mp_indore:['इंदौर','ఇండోర్'],mp_sehore:['सीहोर','సీహోర్'],punjab_ludhiana:['लुधियाना','లూధియానా'],up_lucknow:['लखनऊ','లక్నో'],up_varanasi:['वाराणसी','వారణాసి'],kar_mysuru:['मैसूर','మైసూరు'],tn_coimbatore:['कोयंबटूर','కోయంబత్తూరు'],guj_anand:['आनंद','ఆనంద్']};
  function regionMatch(s, options){
    const q=s.toLowerCase().trim();
    const matches=options.filter(o=>o.value && (o.text.toLowerCase()===q || o.value.split('_').at(-1)===q || (aliases[o.value]||[]).includes(q)));
    return matches.length===1?matches[0].value:null;
  }
  const U=window.MMSeasonUI;
  // Voice follows the site's language switcher; there is no second picker.
  const VOICE_LANGS={en:'en-IN',hi:'hi-IN',te:'te-IN',kn:'kn-IN',ta:'ta-IN'};
  const voiceLang=()=>VOICE_LANGS[window.AgriSimI18n?.getLanguage?.()||'en']||'en-IN';
  function read(value){
    if(!window.speechSynthesis)return;
    speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(value);
    utterance.lang=voiceLang();
    speechSynthesis.speak(utterance);
  }
  window.MMSeasonVoice={parseNumber,regionMatch,read,voiceLang};
  if(!document.getElementById('voiceReview'))return;
  const $=id=>document.getElementById(id);
  $('plannerStatus').after($('voiceStatus'),$('voiceReview'));
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  let recognition=null, target=null, proposed=null, activeButton=null;
  const note=s=>{$('voiceStatus').textContent=U.t(s);};
  // aria-pressed drives the visible "listening" state in season.css.
  const listening=button=>{
    document.querySelectorAll('[data-voice]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    activeButton=button||null;
  };
  const close=()=>{$('voiceReview').hidden=true;proposed=null;target=null;recognition?.abort();recognition=null;listening(null);};
  document.querySelectorAll('[data-voice]').forEach(button=>button.addEventListener('click',()=>{
    if(recognition){const same=activeButton===button;recognition.abort();recognition=null;listening(null);note('Voice input stopped.');if(same)return;}
    close();target=$(button.dataset.voice);
    if(target.disabled||target.readOnly){note('This value comes from your active plot. Edit the plot to change it.');return;}
    if(!Speech){note('Voice is unavailable in this browser. You can type every value.');return;}
    recognition=new Speech();recognition.lang=voiceLang();recognition.interimResults=false;recognition.maxAlternatives=1;
    recognition.onresult=e=>{
      const transcript=e.results[0][0].transcript;
      proposed=target.tagName==='SELECT'?regionMatch(transcript,Array.from(target.options)):parseNumber(transcript);
      if(proposed!==null && target.type==='number' && (proposed<Number(target.min)||proposed>Number(target.max)))proposed=null;
      $('voiceTranscript').textContent=transcript;
      $('voiceProposal').textContent=proposed===null?U.t('Could not interpret this value. Try again or type it.'):U.t('Review value')+': '+(target.tagName==='SELECT'?target.querySelector(`option[value="${proposed}"]`).text:proposed);
      $('voiceApply').disabled=proposed===null;$('voiceReview').hidden=false;note('Review the value before applying it.');
    };
    recognition.onerror=e=>{note(e.error==='not-allowed'?'Microphone access was denied. You can type every value.':'Could not hear a value. Try again or type it.');};
    recognition.onend=()=>{recognition=null;listening(null);};
    try{recognition.start();listening(button);note('Listening. Press the microphone again to stop.');}catch(_){recognition=null;listening(null);note('Voice is unavailable in this browser. You can type every value.');}
  }));
  $('voiceApply').addEventListener('click',()=>{if(target && proposed!==null){target.value=proposed;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));}close();note('Value applied. You can edit it.');});
  $('voiceCancel').addEventListener('click',()=>{close();note('');});
  window.addEventListener('pagehide',()=>{close();window.speechSynthesis?.cancel();});
})();
