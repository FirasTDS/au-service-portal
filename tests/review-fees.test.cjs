const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function setup() {
    const ctx=vm.createContext({URL,structuredClone,crypto:require('node:crypto').webcrypto,
        document:{addEventListener(){}},confirm:()=>true,renderAdminLists(){},showToast(){}});
    const shared=read('shared.js');
    vm.runInContext(shared.slice(shared.indexOf('function normalizeContactInput('),shared.indexOf('function validatePortalData(')),ctx);
    vm.runInContext(read('portal-features.js'),ctx);return ctx;
}
test('merge retains unique approved comments and undo restores each original',()=>{
    const ctx=setup();
    ctx.adminData={services:{taxis:[{name:'A',phone:'0991111111',approved_comments:[{id:'a',text:'First'}]},
        {name:'B',phone:'0991111111',approved_comments:[{id:'a',text:'First'},{id:'b',text:'Second'}]}]},transport:[]};
    const original=JSON.stringify(ctx.adminData.services);
    ctx.mergeDuplicateEntries({type:'service',cat:'taxis',idx:0},{type:'service',cat:'taxis',idx:1});
    assert.deepEqual(Array.from(ctx.adminData.services.taxis[0].approved_comments,c=>c.id),['a','b']);
    ctx.restoreTrash(ctx.adminData.trash[0].id);
    assert.equal(JSON.stringify(ctx.adminData.services),original);
});
test('duty stars use the same identity as the pharmacy and reuse its older receipt',()=>{
    const ctx=setup(),index=read('index.html');
    ctx.getLocalUserRatings=()=>({});ctx.escapeHtml=String;ctx.getStarLabel=()=>'';ctx.reviewCommentsHtml=()=>'';
    vm.runInContext(index.slice(index.indexOf('function createStarsHtml('),index.indexOf('// --- ITEM ROW RENDERING')),ctx);
    const pharmacy={name:'Pharmacy',phone:'0991111111'};
    assert.equal(ctx.createStarsHtml({name:'Display only',review_item:pharmacy}),ctx.createStarsHtml(pharmacy));
    assert.equal(ctx.createStarsHtml({name:'Unknown',review_item:null}),'');
    const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const store={'portal_rating_receipt:0991111111\nPharmacy (مناوبة اليوم 🌙)':id};
    ctx.portalStorage={get:key=>store[key],set:(key,value)=>{store[key]=value;return true;}};
    assert.equal(ctx.ratingReceipt('0991111111\nPharmacy'),id);
});
test('suggestion fee is category-specific and survives approval and editing',()=>{
    const ctx=setup(),fields={sugCategory:{value:'تكاسي وموتورات داخل القدموس'},sugFee:{value:'حسب المسافة'},
        sugAreas:{value:'stale area'},sugKind:{value:'stale kind'},sugSpecialty:{value:'stale specialty'}};
    ctx.document.getElementById=id=>fields[id];
    const taxiNotes=ctx.suggestionDeliveryNotes();
    assert.equal(taxiNotes,'\nأجرة المشوار: حسب المسافة');
    fields.sugCategory.value='الأطباء والعيادات';
    assert.equal(ctx.suggestionDeliveryNotes(),'\nالاختصاص: stale specialty');
    fields.sugCategory.value='ديليفري وتوصيل طلبات';
    assert.ok(!ctx.suggestionDeliveryNotes().includes('stale specialty'));
    const admin=read('admin.html');
    vm.runInContext(admin.slice(admin.indexOf('function buildApprovedItem('),admin.indexOf('async function bulkApprove(')),ctx);
    ctx.checkItemExists=()=>false;
    const suggestion={type:'اقتراح إضافة رقم أو خدمة جديدة',category:'تكاسي وموتورات داخل القدموس',name:'Taxi',phone:'0991111111',notes:taxiNotes,city:''};
    let built=ctx.buildApprovedItem(suggestion);
    assert.equal(built.cat,'taxis');assert.equal(built.newItem.delivery.fee,'حسب المسافة');
    assert.equal(built.newItem.delivery.areas,undefined);
    built=ctx.buildApprovedItem({...suggestion,editedFee:'200 ل.س جديدة'});
    assert.equal(built.newItem.delivery.fee,'200 ل.س جديدة');assert.ok(!built.newItem.note?.includes('حسب المسافة'));
    built=ctx.buildApprovedItem({...suggestion,editedFee:''});assert.equal(built.newItem.delivery.fee,'');
    for (const [category,key,label] of [['شركات المواصلات سرفيس او بولمان','transport','أجرة الخط'],['صهاريج وتعبئة مياه','water','سعر المياه']]) {
        fields.sugCategory.value=category;
        fields.sugFee.value='250 ل.س جديدة';
        const notes=ctx.suggestionDeliveryNotes();
        assert.equal(notes,`\n${label}: 250 ل.س جديدة`);
        const approved=ctx.buildApprovedItem({...suggestion,category,notes,city:'طرطوس'});
        assert.equal(approved.cat,key);assert.equal(approved.newItem.delivery.fee,'250 ل.س جديدة');
        assert.equal(approved.newItem.delivery.areas,undefined);assert.equal(approved.city,'طرطوس');
        assert.equal(ctx.buildApprovedItem({...suggestion,category,notes,editedFee:'300 ل.س جديدة'}).newItem.delivery.fee,'300 ل.س جديدة');
    }
});
