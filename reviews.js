// Only administrator-approved comments are copied into directory entries.
function parseReviewComment(notes) {
    const match = String(notes || '').match(/\[تعليق:([^\]\n]+)\]/);
    if (!match) return null;
    try {
        const text = JSON.parse(decodeURIComponent(match[1]));
        return typeof text === 'string' && text.trim().length >= 3 && text.trim().length <= 1000 ? text.trim() : null;
    } catch { return null; }
}

function reviewCommentsHtml(item) {
    if (Object.hasOwn(item, 'review_item')) {
        if (!item.review_item) return '';
        item = item.review_item;
    }
    const comments = (Array.isArray(item.approved_comments) ? item.approved_comments : [])
        .filter(comment => comment && typeof comment.text === 'string');
    return `<div class="review-comments"><button type="button" class="btn-secondary" data-review-name="${escapeHtml(item.name)}" data-review-contact="${escapeHtml(item.phone || item.link || '')}">اكتب تعليقاً</button>${comments.length ? `<details><summary>تعليقات الزوار (${comments.length})</summary>${comments.map(comment => `<p class="review-comment">${escapeHtml(comment.text)}</p>`).join('')}</details>` : ''}</div>`;
}

function reviewTarget(data, submission) {
    const matches = directoryEntries(data).filter(({item}) => item.name === submission.name && (item.phone || item.link || '') === submission.phone);
    if (matches.length !== 1) throw new Error('تعذر تحديد الجهة بشكل فريد. راجع الاسم والرقم قبل الاعتماد.');
    return matches[0].item;
}

async function approveReviewComment(id) {
    if (!sessionToken || document.getElementById('btnPushGitHub').disabled) return;
    const submission = liveSuggestions.find(item => item.id === id);
    if (!submission || ['approved','ignored'].includes(adminData.suggestion_reviews?.[submission.reviewKey])) return;
    const text = parseReviewComment(submission.notes);
    if (!text) return showToast('التعليق غير صالح (3–1000 حرف).', 'error');
    let target;
    try { target = reviewTarget(adminData, submission); } catch (error) { return showToast(error.message, 'error'); }
    const previous = structuredClone(adminData);
    target.approved_comments ||= [];
    if (!target.approved_comments.some(comment => comment.id === submission.reviewKey)) {
        target.approved_comments.push({id:submission.reviewKey,text});
    }
    if (await persistSuggestionDecision(submission, 'approved', previous)) showToast('تم اعتماد التعليق ونشره.');
}

async function removeReviewComment(id) {
    if (!sessionToken || document.getElementById('btnPushGitHub').disabled) return;
    const submission = liveSuggestions.find(item => item.id === id);
    if (!submission || !confirm('إزالة هذا التعليق من الموقع؟')) return;
    const previous = structuredClone(adminData);
    directoryEntries(adminData).forEach(({item}) => {
        if (Array.isArray(item.approved_comments)) item.approved_comments = item.approved_comments.filter(comment => comment.id !== submission.reviewKey);
    });
    await persistSuggestionDecision(submission, 'ignored', previous);
}

document.addEventListener('click', event => {
    const button = event.target.closest('[data-review-name]');
    if (!button) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'review-dialog';
    dialog.setAttribute('aria-labelledby','reviewDialogTitle');
    dialog.innerHTML = '<form><h2 id="reviewDialogTitle">اكتب تعليقاً</h2><p class="review-place"></p><label for="reviewCommentText">تجربتك مع الخدمة</label><textarea id="reviewCommentText" class="form-input" required minlength="3" maxlength="1000" rows="5" aria-describedby="reviewCommentHint"></textarea><p id="reviewCommentHint">يظهر تعليقك بعد موافقة الإدارة فقط. الحد الأقصى 1000 حرف.</p><p class="review-status" role="status"></p><div class="feature-actions"><button class="btn-primary" type="submit">إرسال للمراجعة</button><button class="btn-secondary" type="button" data-close>إغلاق</button></div></form>';
    dialog.querySelector('.review-place').textContent = button.dataset.reviewName;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const text = dialog.querySelector('textarea').value.trim();
        const status = dialog.querySelector('.review-status');
        if (text.length < 3 || text.length > 1000) { status.textContent = 'أدخل تعليقاً من 3 إلى 1000 حرف.'; return; }
        const submit = dialog.querySelector('[type=submit]');
        submit.disabled = true; status.textContent = 'جارٍ الإرسال…';
        try {
            const fd = new FormData();
            fd.append(ENTRIES.type, 'تقييم خدمة موجودة حالياً');
            fd.append(ENTRIES.category, 'أخرى');
            fd.append(ENTRIES.name, button.dataset.reviewName);
            fd.append(ENTRIES.phone, button.dataset.reviewContact);
            fd.append(ENTRIES.notes, '[تعليق:' + encodeURIComponent(JSON.stringify(text)) + ']');
            const delivery = await submitWithReceipt(fd);
            status.textContent = delivery.confirmed ? 'تم استلام تعليقك، وهو بانتظار موافقة الإدارة.' : 'حُفظ في صندوق الإرسال وبانتظار تأكيد الاستلام، ثم موافقة الإدارة.';
            dialog.querySelector('textarea').disabled = true;
        } catch {
            status.textContent = 'تعذر الإرسال. احتفظنا بالنص هنا؛ راجع صندوق الإرسال قبل المحاولة مجدداً.';
            submit.disabled = false;
        }
    };
    document.body.append(dialog); dialog.showModal();
});
