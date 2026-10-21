const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

function queueSetup(){
    const store={}; let sheet='Timestamp,نوع المشاركة', posts=0, offline=false, confirm=false;
    const ctx=vm.createContext({FormData,AbortController,crypto:webcrypto,URL,
        document:{addEventListener(){},getElementById(){return null;}},window:{addEventListener(){}},showToast(){},
        GOOGLE_FORM_URL:'https://example.test/form',
        portalStorage:{get:key=>store[key],set:(key,value)=>{store[key]=value;return true;}},
        setTimeout:(fn,delay)=>delay===1800?(queueMicrotask(fn),0):setTimeout(fn,delay),clearTimeout,
        fetch:async(url,options)=>{
            if(offline)throw new Error('offline');
            if(options?.method==='POST'){posts++;if(confirm)sheet+='\n'+options.body.get('entry.40821348');return {type:'opaque'};}
            return {ok:true,text:async()=>sheet};
        }});
    vm.runInContext(read('submissions.js'),ctx);
    return {ctx,get posts(){return posts;},set offline(value){offline=value;},set confirm(value){confirm=value;},ack(id){sheet+='\n[إرسال:'+id+']';}};
}
const form=()=>{const fd=new FormData();fd.set('entry.1549210706','Test');fd.set('entry.40821348','details');return fd;};
test('directory transfers preserve fields and insert at the requested position without crossing service/transport types',()=>{
    const ctx=vm.createContext({URL,document:{addEventListener(){}}});vm.runInContext(read('portal-features.js'),ctx);
    const item={name:'A',phone:'0991234567',hours:{allDay:true},rating_contact:'alias'},other={name:'B'};
    const data={services:{restaurants:[item],sweets:[other],rental:[]},transport:[{items:[other]},{items:[]}]};
    assert.equal(ctx.transferDirectoryItem(data,'service:restaurants',0,'service:sweets',0),true);
    assert.deepEqual(data.services.restaurants,[]);assert.equal(data.services.sweets[0],item);
    assert.equal(ctx.transferDirectoryItem(data,'service:sweets',0,'service:rental'),true);
    assert.equal(data.services.rental[0],item);
    assert.equal(ctx.transferDirectoryItem(data,'service:rental',0,'transport:1'),false);
    assert.equal(ctx.transferDirectoryItem(data,'service:rental',-1,'service:sweets'),false);
    assert.equal(ctx.transferDirectoryItem(data,'transport:0',0,'transport:1'),true);
    assert.equal(data.transport[1].items[0],other);
    assert.ok(read('portal-features.js').includes("let activeAdminPanel = 'inbox'"));
});
test('food directory combines subcategories and moving entries preserves all fields and order',()=>{
    const ctx=vm.createContext({URL,document:{addEventListener(){}}});
    vm.runInContext(read('portal-features.js'),ctx);
    const a={name:'A',phone:'0991234567',hours:{allDay:true},rating_contact:'alias'},b={name:'B'},c={name:'C'};
    const services={restaurants:[a,b],sweets:[c]};
    assert.deepEqual(Array.from(ctx.foodDirectoryItems(services)),[a,b,c]);
    assert.deepEqual(Array.from(ctx.foodDirectoryItems(services,'sweets')),[c]);
    assert.equal(ctx.moveFoodEntry(services,'restaurants','sweets',0),true);
    assert.deepEqual(services.restaurants,[b]);assert.deepEqual(services.sweets,[c,a]);
    assert.equal(services.sweets[1],a);
    assert.equal(ctx.moveFoodEntry(services,'sweets','emergency',0),false);
    assert.equal(ctx.moveFoodEntry(services,'sweets','restaurants',-1),false);
});
test('inbox is a compact list with visible actions and no forced wide table',()=>{
    const css=read('style.css');
    assert.ok(!css.includes('min-width:1210px'));
    assert.ok(css.includes('td.inbox-actions {') && css.includes('display:flex;'));
    assert.ok(read('admin.html').includes('id="inboxDetailsModal"'));
    assert.ok(read('admin.html').includes('class="inbox-list-head"'));
    const columns='grid-template-columns:2.75rem minmax(0,1fr) 8rem 16rem';
    assert.equal(css.split(columns).length-1,2,'header and rows share identical columns');
    assert.ok(css.includes('width:fit-content; text-align:start;'));
    assert.ok(css.includes('.inbox-table td.inbox-select { display:flex;'));
});
test('inbox details open separately without hiding list actions or injecting markup',()=>{
    const content={items:[],replaceChildren(){this.items=[];},append(...items){this.items.push(...items);}};
    let opened=false, invoked=false, actionClick;
    const actions={replaceChildren(){},append(){}};
    const source={tagName:'BUTTON',isConnected:true,click(){invoked=true;},cloneNode(){return {removeAttribute(){},addEventListener(type,fn){actionClick=fn;}};}};
    const ctx=vm.createContext({URL,document:{addEventListener(){},createElement(){return {};},
        getElementById:id=>id==='inboxDetailsContent'?content:id==='inboxDetailsActions'?actions:{classList:{add(){opened=true;},remove(){opened=false;}}}}});
    vm.runInContext(read('portal-features.js'),ctx);
    const row={querySelectorAll:selector=>selector==='td[data-label]'?[{dataset:{label:'ملاحظات / بلاغ'},textContent:'<script>unsafe</script>',classList:{contains:()=>false}}]:[source]};
    ctx.toggleInboxDetails({closest:()=>row});assert.equal(opened,true);
    assert.equal(content.items[1].textContent,'<script>unsafe</script>');
    actionClick();assert.equal(invoked,true);assert.equal(opened,false);
    assert.ok(read('admin.html').includes('class="btn-secondary inbox-toggle"'));
});
test('confirmed duplicate merges preserve contacts and pharmacy ownership',()=>{
    const data=JSON.parse(read('data.json'));
    const entries=Object.values(data.services).flat();
    const sugar=entries.filter(i=>i.name==='Sugar bar');assert.equal(sugar.length,1);
    assert.equal(sugar[0].phone,'0940698958');assert.ok(sugar[0].website.includes('instagram.com/sugarbar2026'));
    const ali=entries.filter(i=>i.name==='علي موتور توصيل');assert.equal(ali.length,1);
    assert.ok(ali[0].phone.includes('0993160270')&&ali[0].phone.includes('0997645644'));
    assert.equal(entries.find(i=>i.name==='مشفى القدموس الوطني').phone,'');
    assert.equal(entries.find(i=>i.name==='مستوصف القدموس الصحي').phone,'');
    assert.equal(entries.find(i=>i.name==='صيدلية ديما حسن').phone,'0437553700');
    assert.equal(entries.find(i=>i.name==='صيدلية رهف خدام').phone,'0437553917');
    assert.equal(entries.filter(i=>i.phone==='0951460666').length,2);
});
test('opaque POST does not claim delivery; receipt in Sheet confirms it',async()=>{
    const s=queueSetup(); const result=await s.ctx.submitWithReceipt(form());
    assert.equal(result.confirmed,false);assert.equal(s.ctx.readOutbox().length,1);
    s.ack(result.id);await s.ctx.checkOutbox();assert.equal(s.ctx.readOutbox().length,0);
    s.confirm=true;assert.equal((await s.ctx.submitWithReceipt(form())).confirmed,true);
});
test('offline delivery is retained and retry checks for an existing receipt first',async()=>{
    const s=queueSetup();s.offline=true;
    const result=await s.ctx.submitWithReceipt(form());assert.equal(result.confirmed,false);
    assert.equal(s.ctx.readOutbox().length,1);s.offline=false;s.ack(result.id);
    await s.ctx.retrySubmission(result.id);assert.equal(s.posts,0);assert.equal(s.ctx.readOutbox().length,0);
});
test('retry keeps its receipt; repeated pending submission does not POST twice',async()=>{
    const s=queueSetup();const result=await s.ctx.submitWithReceipt(form());
    await s.ctx.submitWithReceipt(form());assert.equal(s.posts,1);
    s.confirm=true;await s.ctx.retrySubmission(result.id);assert.equal(s.posts,2);assert.equal(s.ctx.readOutbox().length,0);
});
test('storage failure prevents sending an untracked request',async()=>{
    const s=queueSetup();s.ctx.portalStorage.set=()=>false;
    await assert.rejects(()=>s.ctx.submitWithReceipt(form()));assert.equal(s.posts,0);
});

test('a newer pending rating supersedes its old queued vote without inventing acknowledgement',async()=>{
    const s=queueSetup();s.offline=true;
    const old=form();old.set('entry.40821348','[تقييم:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa] [نسخة تقييم:1]');
    const first=await s.ctx.submitWithReceipt(old);
    const next=form();next.set('entry.40821348','[تقييم:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa] [نسخة تقييم:2]');
    const second=await s.ctx.submitWithReceipt(next);
    assert.equal(first.confirmed,false);assert.equal(second.confirmed,false);
    assert.equal(s.ctx.readOutbox().length,1);assert.equal(s.ctx.readOutbox()[0].id,second.id);
    s.offline=false;s.ack(first.id);await s.ctx.checkOutbox();
    assert.equal(s.ctx.readOutbox().length,1,'acknowledging the old vote does not acknowledge the new one');
    await s.ctx.retrySubmission(first.id);assert.equal(s.posts,0,'superseded votes cannot be resent');
});
test('inbox classification prioritizes corrections and reports over ratings',()=>{
    const ctx=vm.createContext({URL,document:{addEventListener(){}}});vm.runInContext(read('portal-features.js'),ctx);
    assert.equal(ctx.inboxKind({type:'تقييم',notes:'[بلاغ خطأ] [تصحيح:x]'}),'correction');
    assert.equal(ctx.inboxKind({type:'تقييم',notes:'[بلاغ خطأ]'}),'report');
    assert.equal(ctx.inboxKind({type:'تقييم'}),'rating');
    assert.equal(ctx.inboxKind({type:'اقتراح'}),'suggestion');
    assert.ok(ctx.placeMapUrl({map_url:'https://maps.app.goo.gl/abc'}));
    assert.ok(ctx.placeMapUrl({link:'https://www.google.com/maps/place/test'}));
    for(const url of ['javascript:alert(1)','https://google.com.evil.test/maps/','https://google.com/search?q=test','http://maps.google.com/'])assert.equal(ctx.placeMapUrl({map_url:url}),'');
    const admin=read('admin.html');assert.ok(admin.includes('data-label="التقييم"'));assert.ok(admin.includes("isRating ? 'تقييم'"));
});
test('open-now excludes unknown and invalid hours',()=>{
    const ctx=vm.createContext({URL,document:{addEventListener(){}}});
    const shared=read('shared.js');vm.runInContext(shared.slice(shared.indexOf('// --- STRUCTURED OPENING HOURS'),shared.indexOf('function validatePortalData(')),ctx);
    vm.runInContext(read('portal-features.js'),ctx);
    assert.equal(ctx.openHoursMatch({dataset:{hours:'null'}}),false);
    assert.equal(ctx.openHoursMatch({dataset:{hours:'invalid'}}),false);
    assert.equal(ctx.openHoursMatch({dataset:{hours:'{"allday":true}'}}),true);
});

test('city normalization merges spelling variants without conflating nearby areas',()=>{
    const ctx=vm.createContext({URL,document:{addEventListener(){}}});vm.runInContext(read('portal-features.js'),ctx);
    assert.equal(ctx.canonicalCityName('  حَمـاه  '),'حماة');
    assert.equal(ctx.canonicalCityName('ريف اللاذقية (الحفة)'),'ريف اللاذقية (الحفة)');
    const data=JSON.parse(read('data.json'));
    assert.equal(data.transport.filter(g=>ctx.canonicalCityName(g.city)==='حماة').length,1);
    assert.ok(data.transport.find(g=>g.city==='حماة').items.some(x=>x.phone==='0932659464'));
});

test('inbox filter buttons default to additions and update only their own group',()=>{
    const values={inboxKind:{value:'suggestion'},inboxStatus:{value:''}};
    const a={dataset:{filter:'inboxKind',value:'suggestion'},setAttribute(k,v){this[k]=v;}};
    const b={dataset:{filter:'inboxKind',value:'rating'},setAttribute(k,v){this[k]=v;}};
    const ctx=vm.createContext({URL,document:{addEventListener(){},getElementById:id=>values[id],querySelectorAll:()=>[a,b]}});
    vm.runInContext(read('portal-features.js'),ctx);
    let calls=0;ctx.applyInboxFilters=()=>calls++;
    ctx.setInboxFilter(b);
    assert.equal(values.inboxKind.value,'rating');assert.equal(values.inboxStatus.value,'');
    assert.equal(a['aria-pressed'],'false');assert.equal(b['aria-pressed'],'true');assert.equal(calls,1);
    assert.ok(read('admin.html').includes('id="inboxKind" value="suggestion"'));
});
