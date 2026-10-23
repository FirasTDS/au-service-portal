const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function context(document={addEventListener(){}}) {
    const ctx=vm.createContext({URL,structuredClone,document});
    const shared=read('shared.js');
    vm.runInContext(shared.slice(shared.indexOf('function normalizeContactInput('),shared.indexOf('function validatePortalData(')),ctx);
    vm.runInContext(read('portal-features.js'),ctx);return ctx;
}
test('dropping a place on category header uses its category, not its category-order handle',()=>{
    const classes={add(){},remove(){}};
    const header={dataset:{reorderGroup:'section-categories-services',reorderIndex:'2'}};
    const zone={dataset:{directoryGroup:'service:sweets'}};
    const hit={closest:selector=>selector==='[data-reorder-group]'?header:zone};
    const doc={addEventListener(){},querySelectorAll:()=>[],elementFromPoint:()=>hit,createElement:()=>({classList:classes,setAttribute(){}})};
    const ctx=context(doc),row={dataset:{},classList:classes,prepend(handle){this.handle=handle;}};
    let transfer, captured=false;
    ctx.reorderControls(row,'service:restaurants',0,()=>assert.fail('should not reorder source'),(...args)=>transfer=args);
    const handle=row.handle;handle.hasPointerCapture=()=>captured;handle.setPointerCapture=()=>captured=true;handle.releasePointerCapture=()=>captured=false;
    handle.onpointerdown({button:0,pointerId:1,preventDefault(){}});
    handle.onpointerup({pointerId:1,type:'pointerup',clientX:0,clientY:0});
    assert.deepEqual(transfer,['service:sweets',undefined]);
});
test('phone, page and map fields cannot be silently interchanged',()=>{
    const ctx=context(),map='https://www.google.com/maps/search/?api=1&query=test';
    const fields=ctx.separateContactFields('0991234567 / 0997654321','https://example.com',map);
    assert.equal(fields.phone,'0991234567 / 0997654321');assert.equal(fields.map_url,map);
    assert.throws(()=>ctx.separateContactFields('https://example.com'));
    assert.throws(()=>ctx.separateContactFields('',map));
    assert.throws(()=>ctx.separateContactFields('','','https://example.com'));
    assert.throws(()=>ctx.separateContactFields('','javascript:alert(1)'));
    const legacy={name:'Place',link:map};
    ctx.applySeparatedContact(legacy,ctx.splitExistingContact(legacy));
    assert.equal(legacy.map_url,map);assert.equal(legacy.phone,'');assert.equal(legacy.link,undefined);assert.equal(legacy.rating_contact,map);
});
test('submission contact metadata reaches dedicated fields without losing phone or links',()=>{
    const ctx=context(),map='https://www.google.com/maps/search/?api=1&query=test';
    const fields=ctx.suggestionContactFields({phone:'0991234567',notes:'رابط الصفحة: https://example.com\nرابط الخريطة: '+map+'\nالعنوان: قرب الجامعة'});
    assert.equal(fields.phone,'0991234567');assert.equal(fields.website,'https://example.com/');assert.equal(fields.address,'قرب الجامعة');
});
test('directory audit is idempotent and leaves every number intact except extracted STAR CITY contacts',()=>{
    const report=JSON.parse(read('tests/directory-field-changes.json'));
    for(const change of report) {
        if(change.before.phone) assert.equal(change.after.phone,change.before.phone,change.before.name);
        if(change.before.link&&change.after.map_url) assert.equal(change.after.map_url,change.before.link);
    }
    const data=JSON.parse(read('data.json')),entries=Object.values(data.services).flat();
    const star=entries.find(item=>item.name==='STAR CITY');
    assert.equal(star.phone,'0945201649 / 0945201581');assert.ok(star.website.startsWith('https://www.facebook.com/'));
    for(const item of entries) {
        assert.ok(!/^https?:/.test(item.phone||''),item.name);
        assert.ok(!/google\.com\/maps\//.test(item.link||''),item.name);
    }
    const result=execFileSync('python',['-X','utf8','scripts/audit-directory-fields.py'],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
    assert.equal(JSON.parse(result).changed,0);
});
test('category tile totals include transport subgroups',()=>{
    assert.ok(read('index.html').includes("const count = card.querySelectorAll('.contact-item').length"));
});
