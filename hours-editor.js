// Per-day editor; stored schedules retain the existing start-day/overnight semantics.
const weeklyHoursEditors = new Map();
function hoursToWeek(hours) {
    const week = Array.from({length:7}, () => []);
    const periods = hours?.periods || (hours && !hours.closed ? [hours] : []);
    periods.forEach(period => (period.days || [0,1,2,3,4,5,6]).forEach(day => {
        if (week[day]) week[day].push(period.allday ? {allday:true} : {open:period.open,close:period.close});
    }));
    return week;
}
function weekToHours(week) {
    const groups = new Map();
    week.forEach((slots,day) => slots.forEach(slot => {
        const key = slot.allday ? '24' : slot.open + '/' + slot.close;
        if (!groups.has(key)) groups.set(key,{...slot,days:[]});
        if (!groups.get(key).days.includes(day)) groups.get(key).days.push(day);
    }));
    if (!groups.size) return {closed:true};
    const periods = [...groups.values()];
    return validateReportHours(periods.length === 1 ? periods[0] : {periods});
}
function ensureWeeklyHoursEditor(prefix) {
    if (weeklyHoursEditors.has(prefix)) return weeklyHoursEditors.get(prefix);
    const anchor = document.getElementById(prefix + 'HoursDays');
    if (!anchor) return null;
    const parent = anchor.parentElement;
    // Keep legacy fields for compatibility, but only the weekly controls are visible.
    [...parent.children].forEach(child => { if (child.tagName !== 'LEGEND' && (child.tagName !== 'LABEL' || child.querySelector('input'))) child.hidden = true; });
    const root = document.createElement('section'); root.className = 'weekly-hours'; root.setAttribute('aria-label','جدول الدوام الأسبوعي');
    const summary = document.createElement('div'); summary.className = 'weekly-hours-list'; root.append(summary);
    const quick = document.createElement('div'); quick.className = 'weekly-hours-quick';
    const pane = document.createElement('fieldset'); pane.className = 'weekly-hours-pane'; pane.hidden = true;
    const legend = document.createElement('legend'); legend.textContent = 'اختر الأيام والوقت'; pane.append(legend);
    const dayBox = document.createElement('div'); dayBox.className = 'weekly-hours-days';
    const checks = [0,1,2,3,4,5,6].map(day => {
        const label = document.createElement('label'), input = document.createElement('input'); input.type='checkbox'; input.value=day;
        const text = document.createElement('span'); text.textContent=AR_DAY_NAMES[day]; label.append(input,text); dayBox.append(label); return input;
    });
    pane.append(dayBox);
    const modes = document.createElement('div'); modes.className='weekly-hours-modes';
    const radios = {};
    for (const [value,text] of [['times','ساعات محددة'],['allday','24 ساعة'],['closed','مغلق']]) {
        const label=document.createElement('label'), input=document.createElement('input'); input.type='radio'; input.name=prefix+'WeeklyMode'; input.value=value;
        label.append(input,document.createTextNode(text)); modes.append(label); radios[value]=input;
    }
    pane.append(modes);
    const shifts=document.createElement('div'); shifts.className='weekly-hours-shifts'; pane.append(shifts);
    const add = featureButton('+ إضافة فترة',()=>addSlot({})); add.classList.add('weekly-hours-add'); pane.append(add);
    const hint=document.createElement('p'); hint.className='contact-note weekly-hours-hint'; hint.textContent='الدوام الليلي ينتهي في اليوم التالي.\nيُطبَّق التعديل على الأيام المحددة فقط.'; pane.append(hint);
    const error=document.createElement('p'); error.className='weekly-hours-error'; error.setAttribute('role','alert'); pane.append(error);
    const actions=document.createElement('div'); actions.className='weekly-hours-quick weekly-hours-actions'; pane.append(actions);
    const state={prefix,root,summary,pane,week:hoursToWeek(null),original:null,dirty:false};
    function syncMode() { const enabled=radios.times.checked; shifts.hidden=add.hidden=!enabled; shifts.querySelectorAll('input').forEach(input=>input.disabled=!enabled); }
    Object.values(radios).forEach(radio=>radio.addEventListener('change',syncMode));
    function addSlot(slot) {
        const row=document.createElement('div'); row.className='weekly-hours-shift';
        for (const [key,text] of [['open','وقت الفتح'],['close','وقت الإغلاق']]) {
            const label=document.createElement('label'); label.textContent=text;
            const input=document.createElement('input'); input.type='time'; input.dir='ltr'; input.className='form-input'; input.dataset.time=key; input.value=slot[key] || ''; label.append(input); row.append(label);
        }
        const remove=featureButton('✕',()=>row.remove()); remove.setAttribute('aria-label','حذف الفترة'); row.append(remove); shifts.append(row);
    }
    state.edit = days => {
        error.textContent=''; checks.forEach((input,day)=>input.checked=days.includes(day));
        const slots=state.week[days[0]];
        radios.allday.checked=slots.some(slot=>slot.allday); radios.closed.checked=!slots.length; radios.times.checked=!!slots.length&&!radios.allday.checked;
        // Unknown schedules start with editable time fields, not an implicit closure.
        if (!state.original && !state.dirty) {radios.times.checked=true;radios.closed.checked=false;}
        shifts.replaceChildren(); slots.filter(slot=>!slot.allday).forEach(addSlot); if (!shifts.children.length) addSlot({});
        pane.hidden=false; syncMode(); checks[0].focus();
    };
    const apply=featureButton('تطبيق على الأيام المختارة',()=>{
        try {
            const days=checks.filter(input=>input.checked).map(input=>Number(input.value));
            if (!days.length) throw new Error('اختر يوماً واحداً على الأقل.');
            let slots=[];
            if (radios.allday.checked) slots=[{allday:true}];
            else if (radios.times.checked) {
                slots=[...shifts.children].map(row=>({open:row.querySelector('[data-time="open"]').value,close:row.querySelector('[data-time="close"]').value}));
                if (!slots.length) throw new Error('أضف فترة دوام أو اختر مغلق.');
                slots.forEach(slot=>validateReportHours({...slot,days}));
            }
            const next=state.week.map((old,day)=>days.includes(day)?slots.map(slot=>({...slot})):old);
            weekToHours(next); state.week=next; state.dirty=true; pane.hidden=true; renderWeeklyHours(state); summary.querySelector('button')?.focus();
        } catch(err) {error.textContent=err.message;}
    }); apply.className='btn-primary'; actions.append(apply,featureButton('إلغاء',()=>{pane.hidden=true;summary.querySelector('button')?.focus();}));
    for (const [text,days] of [['تعديل كل الأيام',[0,1,2,3,4,5,6]],['الأحد–الخميس',[0,1,2,3,4]],['الجمعة–السبت',[5,6]]]) quick.append(featureButton(text,()=>state.edit(days)));
    const clear=featureButton('إزالة ساعات الدوام',()=>{fillWeeklyHours(prefix,null);state.cleared=true;}); quick.append(clear);
    root.append(quick,pane); parent.append(root); weeklyHoursEditors.set(prefix,state); renderWeeklyHours(state); return state;
}
function renderWeeklyHours(state) {
    state.summary.replaceChildren();
    state.week.forEach((slots,day)=>{
        const row=document.createElement('div'); row.className='weekly-hours-day';
        const name=document.createElement('span'); name.textContent=AR_DAY_NAMES[day];
        const text=document.createElement('span'); text.className='weekly-hours-value'; text.dir='auto';
        text.textContent=!state.original&&!state.dirty?'غير محدد':!slots.length?'مغلق':slots.some(slot=>slot.allday)?'24 ساعة':slots.map(slot=>slot.open+' – '+slot.close+(slot.close<slot.open?' (اليوم التالي)':'')).join(' / ');
        const edit=featureButton('✎',()=>state.edit([day])); edit.setAttribute('aria-label','تعديل دوام '+AR_DAY_NAMES[day]);
        row.append(name,text,edit); state.summary.append(row);
    });
}
function fillWeeklyHours(prefix,hours) {
    const state=ensureWeeklyHoursEditor(prefix); if (!state) return;
    state.original=hours?structuredClone(hours):null; state.week=hoursToWeek(hours); state.dirty=false; state.cleared=false; state.pane.hidden=true; renderWeeklyHours(state);
}
function collectWeeklyHours(prefix) {
    const state=weeklyHoursEditors.get(prefix); if (!state) return undefined;
    if (!state.pane.hidden) throw new Error('طبّق تعديل الدوام أو ألغِه قبل الحفظ.');
    return state.dirty?weekToHours(state.week):state.original;
}
