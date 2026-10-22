const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function setup() {
    const ctx=vm.createContext({URL,structuredClone,document:{addEventListener(){}}});
    const shared=read('shared.js');
    vm.runInContext(shared.slice(shared.indexOf('function normalizeContactInput('),shared.indexOf('function validatePortalData(')),ctx);
    vm.runInContext(read('portal-features.js'),ctx); vm.runInContext(read('hours-editor.js'),ctx);
    return ctx;
}
test('weekly schedules preserve legacy, split-shift, 24-hour and overnight opening status',()=>{
    const ctx=setup();
    for (const hours of [{open:'08:00',close:'22:00'},{allday:true,days:[0,6]},
        {open:'20:00',close:'02:00',days:[5]},
        {periods:[{open:'08:00',close:'12:00',days:[0,1,2]},{open:'16:00',close:'22:00',days:[0,1,2]},{allday:true,days:[6]}]}]) {
        const converted=ctx.weekToHours(ctx.hoursToWeek(hours));
        for(let day=0;day<7;day++) for(let minutes=0;minutes<1440;minutes+=30) {
            const open=h=>ctx.getOpenStatusBadge({hours:h},{day,minutes}).includes('status-badge-open');
            assert.equal(open(converted),open(hours),JSON.stringify({hours,day,minutes}));
        }
    }
});
test('closed all week is explicit, validates and cannot pass the open-now filter',()=>{
    const ctx=setup(), hours=ctx.weekToHours(ctx.hoursToWeek(null));
    assert.equal(hours.closed,true); assert.equal(ctx.validateReportHours(hours).closed,true);
    assert.match(ctx.hoursLabel(hours),/مغلق/);
    assert.ok(ctx.getOpenStatusBadge({hours},{day:1,minutes:600}).includes('status-badge-closed'));
});
test('weekly serialization rejects invalid and excessive shifts',()=>{
    const ctx=setup(), week=ctx.hoursToWeek(null);
    week[0]=[{open:'09:00',close:'09:00'}];assert.throws(()=>ctx.weekToHours(week));
    week[0]=Array.from({length:15},(_,i)=>({open:'08:'+String(i).padStart(2,'0'),close:'12:00'}));
    assert.throws(()=>ctx.weekToHours(week),/14/);
});
test('weekly hours and modal scrollbar assets are available online and offline',()=>{
    for(const file of ['admin.html','index.html']) assert.ok(read(file).includes('hours-editor.js?v='));
    assert.ok(read('sw.js').includes("'hours-editor.js'"));
    assert.ok(read('style.css').includes('scrollbar-color:var(--color-slate-400) var(--surface)'));
    assert.ok(read('admin.html').includes('id="submissionHoursDays"'));
    assert.ok(read('admin.html').includes('newItem.hours = validateReportHours(item.editedHours)'));
    assert.ok(read('style.css').includes('grid-template-columns:repeat(auto-fit,minmax(4rem,1fr))'));
    assert.ok(read('style.css').includes('.weekly-hours-shift button { grid-column:2; grid-row:1/3; }'));
});
