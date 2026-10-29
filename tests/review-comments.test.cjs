const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
    const context = vm.createContext({document:{addEventListener(){},getElementById(){return {disabled:false};}},
        escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
        directoryEntries:data=>data.services.test.map(item=>({item})),structuredClone,
        sessionToken:'test',showToast(){},confirm:()=>true});
    vm.runInContext(fs.readFileSync('reviews.js','utf8'),context);
    return context;
}
const notes = text => '[تعليق:'+encodeURIComponent(JSON.stringify(text))+']';
test('comments validate length and safely render only approved entry comments',()=>{
    const c=setup();
    assert.equal(c.parseReviewComment(notes('   مرحباً   ')),'مرحباً');
    for(const value of ['a','x'.repeat(1001),{},null]) assert.equal(c.parseReviewComment(notes(value)),null);
    assert.equal(c.parseReviewComment('[تعليق:%broken]'),null);
    assert.ok(!c.reviewCommentsHtml({name:'Service',notes:notes('pending')}).includes('pending'));
    const html=c.reviewCommentsHtml({name:'Service',approved_comments:[{text:'<script>alert(1)</script>'}]});
    assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script>'));
    assert.equal(c.reviewCommentsHtml({name:'Duty display',review_item:null}), '');
    assert.ok(c.reviewCommentsHtml({name:'Duty display',review_item:{name:'Canonical pharmacy',phone:'123'}}).includes('data-review-name="Canonical pharmacy"'));
});
test('approval persists exact target once; rejection publishes nothing and failed save rolls back',async()=>{
    const c=setup();
    c.adminData={services:{test:[{name:'Service',phone:'123'}]}};
    c.liveSuggestions=[{id:1,name:'Service',phone:'123',notes:notes('A useful comment'),reviewKey:'abc'}];
    c.persistSuggestionDecision=async(item,status)=>{ c.adminData.suggestion_reviews={[item.reviewKey]:status};return true; };
    await c.approveReviewComment(1);await c.approveReviewComment(1);
    assert.equal(c.adminData.services.test[0].approved_comments.length,1);
    await c.removeReviewComment(1);assert.equal(c.adminData.services.test[0].approved_comments.length,0);
    await c.approveReviewComment(1);assert.equal(c.adminData.services.test[0].approved_comments.length,0);
    c.adminData.suggestion_reviews={};
    c.persistSuggestionDecision=async(item,status,previous)=>{c.adminData=previous;return false;};
    await c.approveReviewComment(1);assert.equal(c.adminData.services.test[0].approved_comments.length,0);
    c.adminData.services.test.push({name:'Service',phone:'123'});
    assert.throws(()=>c.reviewTarget(c.adminData,c.liveSuggestions[0]),/فريد/);
});
