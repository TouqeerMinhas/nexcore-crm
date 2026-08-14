'use strict';

let me = null;
let clients = [];
let callers = [];
let callerCacheLoaded = false;
let clientRequestController = null;
let clientSearchTimer = null;
let lastClientRequestKey = '';

const $ = (id) => document.getElementById(id);

const domainOptions = [
    'Web Development',
    'Designing',
    'UI/UX Design',
    'Video Editing',
    'Social Media Marketing',
    'AI Automation'
];

const statuses = [
    'Not Contacted',
    'Received',
    'Not Received',
    'Declined',
    'Scheduled',
    'Follow-up',
    'Interested',
    'Closed Won',
    'Closed Lost'
];

const channels = ['Call', 'Email', 'WhatsApp'];


function showLoginCard() {
    $('resetPasswordCard')?.classList.add('hidden');
    $('login')?.querySelector('.login-card')?.classList.remove('hidden');
    if ($('resetMessage')) $('resetMessage').textContent = '';
}

function showResetCard() {
    $('login')?.querySelector('.login-card')?.classList.add('hidden');
    $('resetPasswordCard')?.classList.remove('hidden');

    if ($('resetEmail') && $('email')) {
        $('resetEmail').value = $('email').value.trim();
    }
}

function setResetMessage(message, type = 'muted') {
    const element = $('resetMessage');
    if (!element) return;

    element.textContent = message;
    element.style.color = type === 'error'
        ? '#710014'
        : type === 'success'
            ? '#2f6b45'
            : 'var(--muted)';
}

async function requestPasswordReset() {
    const email = $('resetEmail')?.value.trim();
    const button = $('sendResetCodeBtn');

    if (!email) {
        setResetMessage('Enter your CRM account email.', 'error');
        return;
    }

    setButtonBusy(button, true, 'Sending...');
    setResetMessage('Sending your reset code...');

    try {
        const result = await api('/api/forgot-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        if ($('completeResetForm')) {
            $('completeResetForm').classList.remove('hidden');
        }

        setResetMessage(
            result.message || 'If that account email exists, a reset code has been sent.',
            'success'
        );

        $('resetCode')?.focus();
    } catch (error) {
        setResetMessage(error.message || 'Could not send the reset code.', 'error');
    } finally {
        setButtonBusy(button, false);
    }
}

async function completePasswordReset() {
    const email = $('resetEmail')?.value.trim();
    const code = $('resetCode')?.value.trim();
    const newPassword = $('newPassword')?.value || '';
    const confirmPassword = $('confirmPassword')?.value || '';
    const button = $('resetPasswordBtn');

    if (newPassword !== confirmPassword) {
        setResetMessage('The new passwords do not match.', 'error');
        return;
    }

    setButtonBusy(button, true, 'Resetting...');
    setResetMessage('Verifying your code...');

    try {
        const result = await api('/api/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                code,
                newPassword
            })
        });

        alert(result.message || 'Password reset successfully.');

        if ($('password')) $('password').value = '';
        if ($('email')) $('email').value = email;
        if ($('resetCode')) $('resetCode').value = '';
        if ($('newPassword')) $('newPassword').value = '';
        if ($('confirmPassword')) $('confirmPassword').value = '';
        if ($('completeResetForm')) $('completeResetForm').classList.add('hidden');

        showLoginCard();
        $('password')?.focus();
    } catch (error) {
        setResetMessage(error.message || 'Could not reset the password.', 'error');
    } finally {
        setButtonBusy(button, false);
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[match]));
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function setButtonBusy(button, busy, text = 'Saving...') {
    if (!button) return;

    if (busy) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }
        button.disabled = true;
        button.textContent = text;
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
    }
}

function setLoading(element, message = 'Loading...') {
    if (element) {
        element.innerHTML = `<div class="muted">${escapeHtml(message)}</div>`;
    }
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (response.status === 401 && !url.includes('/api/login')) {
        me = null;
        $('app')?.classList.add('hidden');
        $('login')?.classList.remove('hidden');
        throw new Error('Your session has expired. Please sign in again.');
    }

    if (!response.ok) {
        throw new Error(data.error || data.detail || `Request failed (${response.status})`);
    }

    return data;
}

function showError(error, fallback = 'Something went wrong.') {
    const message = error?.message || fallback;
    alert(message);
}

function fillStatusFilter() {
    if (!$('statusFilter')) return;

    $('statusFilter').innerHTML = [
        '<option value="">All statuses</option>',
        ...statuses.map((status) => `<option value="${escapeAttr(status)}">${escapeHtml(status)}</option>`)
    ].join('');
}

function fillCallerFilter() {
    if (!$('callerFilter')) return;

    $('callerFilter').innerHTML = [
        '<option value="">All callers</option>',
        ...callers.map((caller) => (
            `<option value="${escapeAttr(caller.id)}">${escapeHtml(caller.name)}</option>`
        ))
    ].join('');
}

async function ensureCallers(force = false) {
    if (!me || me.role !== 'admin') return;
    if (callerCacheLoaded && !force) return;

    const data = await api('/api/callers');
    callers = Array.isArray(data) ? data : [];
    callerCacheLoaded = true;
    fillCallerFilter();
}

async function loadLogo() {
    try {
        const data = await api('/api/settings/logo');
        const url = data.logoUrl || '';

        ['loginLogo', 'sidebarLogo', 'brandingPreviewLogo'].forEach((id) => {
            const element = $(id);
            if (!element) return;

            element.classList.toggle('hidden', !url);
            if (url) element.src = url;
        });

        ['loginLogoFallback', 'sidebarLogoFallback', 'brandingPreviewFallback'].forEach((id) => {
            const element = $(id);
            if (element) element.classList.toggle('hidden', Boolean(url));
        });
    } catch (error) {
        console.warn('Could not load agency logo:', error);
    }
}

async function boot() {
    try {
        await loadLogo();

        const data = await api('/api/me');
        me = data.user;

        $('login')?.classList.add('hidden');
        $('app')?.classList.remove('hidden');

        if ($('userName')) $('userName').textContent = me.name;
        if ($('userRole')) $('userRole').textContent = me.role.toUpperCase();

        document.querySelectorAll('.adminOnly').forEach((element) => {
            element.classList.toggle('hidden', me.role !== 'admin');
        });

        fillStatusFilter();
        await showView('dashboard');
    } catch (error) {
        if (!String(error?.message || '').toLowerCase().includes('session')) {
            console.warn('CRM boot failed:', error);
        }
    }
}

function navigationLabels(view) {
    return {
        dashboard: {
            title: 'Dashboard',
            subtitle: 'Sales activity overview'
        },
        clients: {
            title: 'Clients',
            subtitle: 'Manage leads and follow-ups'
        },
        followups: {
            title: 'Follow-up Center',
            subtitle: 'Due, today and upcoming follow-up calls'
        },
        calls: {
            title: 'Call Recordings',
            subtitle: 'Listen to recorded calls'
        },
        callers: {
            title: 'Caller Accounts',
            subtitle: 'Create and manage caller accounts'
        },
        branding: {
            title: 'Agency Branding',
            subtitle: 'Upload or replace your agency logo'
        }
    }[view] || {
        title: 'Dashboard',
        subtitle: 'Sales activity overview'
    };
}

async function showView(view) {
    if (view === 'callers' && me?.role !== 'admin') {
        showError(new Error('Caller account management is available to admins only.'));
        return;
    }
    document.querySelectorAll('.view').forEach((element) => element.classList.add('hidden'));

    const target = $(`${view}View`);
    if (!target) return;

    target.classList.remove('hidden');

    const labels = navigationLabels(view);
    if ($('pageTitle')) $('pageTitle').textContent = labels.title;
    if ($('subTitle')) $('subTitle').textContent = labels.subtitle;

    try {
        if (view === 'dashboard') await loadDashboard();
        if (view === 'clients') await loadClients();
        if (view === 'followups') await loadFollowups();
        if (view === 'calls') await loadAllCalls();
        if (view === 'callers') await loadCallers();
        if (view === 'branding') await loadLogo();
    } catch (error) {
        showError(error);
    }
}

function statusSegments(byStatus, total) {
    const statusStyles = [
        ['Closed Won', '#710014'],
        ['Interested', '#b38f6f'],
        ['Scheduled', '#a76c82'],
        ['Follow-up', '#d1aa91'],
        ['Received', '#8d6d68'],
        ['Not Received', '#b8b0aa'],
        ['Declined', '#8f2a3c'],
        ['Not Contacted', '#d9d4cc'],
        ['Closed Lost', '#3d3532']
    ];

    if (!total) {
        return { background: '#dedad3', legend: '<span class="chart-legend-empty">No leads yet</span>' };
    }

    let cursor = 0;
    const stops = [];
    const legend = [];

    for (const [status, color] of statusStyles) {
        const count = Number(byStatus?.[status] || 0);
        if (!count) continue;
        const start = (cursor / total) * 360;
        cursor += count;
        const end = (cursor / total) * 360;
        stops.push(`${color} ${start}deg ${end}deg`);
        legend.push(`<span><i style="background:${color}"></i>${escapeHtml(status)} <b>${count}</b></span>`);
    }

    return {
        background: `conic-gradient(${stops.join(', ')})`,
        legend: legend.join('')
    };
}

function performanceCard(performance, title, subtitle = '') {
    const totals = performance?.totals || {};
    const total = Number(totals.clients || 0);
    const progress = Math.min(Math.max(Number(performance?.progress || 0), 0), 100);
    const segments = statusSegments(performance?.byStatus || {}, total);

    return `
        <article class="performance-card">
            <div class="performance-card-head">
                <div>
                    <h4>${escapeHtml(title)}</h4>
                    <span>${escapeHtml(subtitle || `${total} total leads`)}</span>
                </div>
                <strong>${progress}%</strong>
            </div>

            <div class="performance-main">
                <div class="donut" style="--donut:${segments.background}">
                    <div class="donut-center">
                        <b>${progress}%</b>
                        <span>Won</span>
                    </div>
                </div>

                <div class="performance-summary">
                    <div><span>Leads</span><b>${total}</b></div>
                    <div><span>Calls</span><b>${Number(totals.calls || 0)}</b></div>
                    <div><span>Follow-ups</span><b>${Number(totals.followups || 0)}</b></div>
                    <div><span>Closed Won</span><b>${Number(totals.wins || 0)}</b></div>
                </div>
            </div>

            <div class="chart-legend">
                ${segments.legend}
            </div>

            <div class="caller-progress-track">
                <div style="width:${progress}%"></div>
            </div>
        </article>
    `;
}

function renderPerformance(data) {
    const container = $('performanceGrid');
    if (!container) return;

    if (me?.role === 'admin') {
        const cards = Array.isArray(data.callerStats) ? data.callerStats : [];
        container.innerHTML = cards.length
            ? cards.map((item) => performanceCard(item, item.callerName || 'Caller', 'Caller performance')).join('')
            : '<div class="empty-performance">No caller accounts have been created yet.</div>';
        if ($('chartSubtitle')) $('chartSubtitle').textContent = `${cards.length} caller${cards.length === 1 ? '' : 's'} performance overview`;
        return;
    }

    container.innerHTML = performanceCard(data, 'My Performance', `${me?.name || 'Caller'} · personal dashboard`);
    if ($('chartSubtitle')) $('chartSubtitle').textContent = 'Your current lead performance';
}

async function loadDashboard() {
    const data = await api('/api/dashboard');
    const totals = data.totals || {};
    const byStatus = data.byStatus || {};

    if ($('statClients')) $('statClients').textContent = totals.clients ?? 0;
    if ($('statCalls')) $('statCalls').textContent = totals.calls ?? 0;
    if ($('statFollowups')) $('statFollowups').textContent = totals.followups ?? 0;
    if ($('statWins')) $('statWins').textContent = totals.wins ?? 0;

    renderPerformance(data);

    // Keep the reminder strip and badge in sync with dashboard data.
    loadFollowups({ silent: true }).catch(() => {});

    const pipelineKeys = [
        'Not Contacted',
        'Received',
        'Not Received',
        'Declined',
        'Scheduled',
        'Follow-up',
        'Interested',
        'Closed Won',
        'Closed Lost'
    ];

    if ($('pipeline')) {
        $('pipeline').innerHTML = pipelineKeys.map((status) => `
            <div class="pipe">
                <b>${Number(byStatus[status] || 0)}</b>
                <span>${escapeHtml(status)}</span>
            </div>
        `).join('');
    }

    const clientCount = Number(totals.clients || 0);
    const wins = Number(totals.wins || 0);
    const rate = clientCount > 0 ? Math.round((wins / clientCount) * 100) : 0;

    if ($('progressBar')) $('progressBar').style.width = `${Math.min(rate, 100)}%`;
    if ($('progressText')) $('progressText').textContent = `${rate}% closed won`;
}


function followupBucketLabel(bucket) {
    return {
        overdue: 'Overdue',
        today: 'Today',
        upcoming: 'Upcoming'
    }[bucket] || 'Follow-up';
}

function followupBucketClass(bucket) {
    return bucket === 'overdue' ? 'overdue' : bucket === 'today' ? 'today' : 'upcoming';
}

function followupItemHtml(client) {
    const bucket = client.reminderBucket || 'upcoming';
    return `
        <article class="followup-item ${followupBucketClass(bucket)}">
            <div>
                <div class="followup-company">${escapeHtml(client.company || client.phone || 'Unnamed client')}</div>
                <div class="followup-contact">
                    ${escapeHtml(client.contactName || 'No contact name')} · ${escapeHtml(client.phone || 'No phone')}
                </div>
                <div class="followup-meta">
                    <span class="followup-tag">${escapeHtml(followupBucketLabel(bucket))}</span>
                    <span class="followup-tag">${escapeHtml(formatDateTime(client.followUpAt || client.nextFollowUp))}</span>
                    <span class="followup-tag">Status: ${escapeHtml(client.status || 'Follow-up')}</span>
                    ${client.assignedToName ? `<span class="followup-tag">Caller: ${escapeHtml(client.assignedToName)}</span>` : ''}
                </div>
            </div>
            <div class="followup-actions">
                <button class="secondary" type="button" data-followup-action="call" data-id="${escapeAttr(client.id)}">Log Call</button>
                <button class="icon-btn" type="button" data-followup-action="edit" data-id="${escapeAttr(client.id)}">Edit</button>
            </div>
        </article>
    `;
}

function renderFollowupSummary(data) {
    const summary = $('followupSummary');
    if (!summary) return;

    summary.innerHTML = `
        <div class="followup-summary-card overdue">
            <strong>${data.overdue.length}</strong>
            <span>Overdue</span>
        </div>
        <div class="followup-summary-card">
            <strong>${data.today.length}</strong>
            <span>Due Today</span>
        </div>
        <div class="followup-summary-card">
            <strong>${data.upcoming.length}</strong>
            <span>Upcoming</span>
        </div>
    `;
}

function renderFollowupList(data) {
    const list = $('followupList');
    if (!list) return;

    const groups = [
        ['overdue', 'Overdue Follow-ups'],
        ['today', 'Today\'s Follow-ups'],
        ['upcoming', 'Upcoming Follow-ups']
    ];

    const sections = groups
        .map(([key, title]) => {
            const items = Array.isArray(data[key]) ? data[key] : [];
            if (!items.length) return '';
            return `
                <div class="followup-group-title">${title} · ${items.length}</div>
                ${items.map(followupItemHtml).join('')}
            `;
        })
        .join('');

    list.innerHTML = sections || '<div class="followup-empty">No scheduled follow-ups right now.</div>';
}

function updateFollowupBadge(data) {
    const badge = $('followupBadge');
    if (!badge) return;

    const urgent = (data.overdue?.length || 0) + (data.today?.length || 0);
    badge.textContent = urgent;
    badge.classList.toggle('hidden', urgent === 0);
}

function renderDashboardReminder(data) {
    const reminder = $('dashboardReminder');
    if (!reminder) return;

    const overdue = data.overdue?.length || 0;
    const today = data.today?.length || 0;
    const totalUrgent = overdue + today;

    reminder.classList.toggle('hidden', totalUrgent === 0);

    if (totalUrgent === 0) return;

    reminder.innerHTML = `
        <strong>${totalUrgent} follow-up${totalUrgent === 1 ? '' : 's'} need attention</strong>
        <span>${overdue ? `${overdue} overdue` : ''}${overdue && today ? ' · ' : ''}${today ? `${today} due today` : ''}. Open Follow-up Center to work through them.</span>
    `;
}

async function loadFollowups({ silent = false } = {}) {
    try {
        if (!silent) setLoading($('followupList'), 'Loading follow-ups...');

        const data = await api('/api/followups');
        data.overdue = Array.isArray(data.overdue) ? data.overdue : [];
        data.today = Array.isArray(data.today) ? data.today : [];
        data.upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];

        renderFollowupSummary(data);
        renderFollowupList(data);
        updateFollowupBadge(data);
        renderDashboardReminder(data);
        maybeNotifyFollowups(data);
        return data;
    } catch (error) {
        if (!silent) {
            const list = $('followupList');
            if (list) list.innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
        }
        throw error;
    }
}

let notifiedFollowupKeys = new Set();

function maybeNotifyFollowups(data) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const urgent = [...(data.overdue || []), ...(data.today || [])].slice(0, 5);
    urgent.forEach((client) => {
        const key = `${client.id}|${client.followUpAt || client.nextFollowUp}`;
        if (notifiedFollowupKeys.has(key)) return;
        notifiedFollowupKeys.add(key);

        const prefix = client.reminderBucket === 'overdue' ? 'Overdue follow-up' : 'Follow-up due today';
        new Notification(`NexCore CRM · ${prefix}`, {
            body: `${client.company || client.phone || 'Client'} · ${formatDateTime(client.followUpAt || client.nextFollowUp)}`
        });
    });
}

async function enableFollowupNotifications() {
    if (typeof Notification === 'undefined') {
        alert('Browser notifications are not supported here. The in-CRM Follow-up Center and badge will still work.');
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            alert('Follow-up browser reminders are enabled.');
            await loadFollowups({ silent: true });
        } else {
            alert('Browser notifications were not enabled. The in-CRM reminder badge remains active.');
        }
    } catch (error) {
        showError(error);
    }
}

function getClientRequestParams() {
    const params = new URLSearchParams();
    const search = $('search')?.value?.trim() || '';
    const status = $('statusFilter')?.value || '';
    const assignedTo = $('callerFilter')?.value || '';

    if (search) params.set('q', search);
    if (status) params.set('status', status);
    if (me?.role === 'admin' && assignedTo) params.set('assignedTo', assignedTo);

    return params;
}

async function loadClients({ force = false } = {}) {
    await ensureCallers();

    const params = getClientRequestParams();
    const requestKey = params.toString();

    if (!force && requestKey === lastClientRequestKey && clients.length) {
        renderClients();
        return;
    }

    if (clientRequestController) {
        clientRequestController.abort();
    }

    clientRequestController = new AbortController();
    lastClientRequestKey = requestKey;

    setLoading($('clientsBody'), 'Loading leads...');

    try {
        const data = await api(`/api/clients?${requestKey}`, {
            signal: clientRequestController.signal
        });

        clients = Array.isArray(data) ? data : [];
        renderClients();
    } catch (error) {
        if (error.name !== 'AbortError') {
            $('clientsBody').innerHTML = `
                <tr>
                    <td colspan="9" class="muted">${escapeHtml(error.message)}</td>
                </tr>
            `;
            throw error;
        }
    }
}

function scheduleClientSearch() {
    clearTimeout(clientSearchTimer);

    clientSearchTimer = setTimeout(() => {
        loadClients({ force: true }).catch(showError);
    }, 280);
}

function renderClients() {
    const body = $('clientsBody');
    if (!body) return;

    if (!clients.length) {
        body.innerHTML = `
            <tr>
                <td colspan="9" class="muted">No leads found.</td>
            </tr>
        `;
        return;
    }

    body.innerHTML = clients.map((client) => {
        const channelsText = Array.isArray(client.contactChannels) && client.contactChannels.length
            ? client.contactChannels.map(escapeHtml).join(', ')
            : '—';

        return `
            <tr>
                <td class="phone">${escapeHtml(client.phone || '—')}</td>
                <td>
                    <div class="company">${escapeHtml(client.company || '—')}</div>
                    <div class="muted">${escapeHtml(client.contactName || '—')}</div>
                </td>
                <td>${escapeHtml(client.email || '—')}</td>
                <td><span class="status-pill">${escapeHtml(client.status || 'Not Contacted')}</span></td>
                <td>${escapeHtml(formatDateTime(client.nextFollowUp))}</td>
                <td>${channelsText}</td>
                <td>${escapeHtml(client.dealDomain || '—')}</td>
                <td>${escapeHtml(client.assignedToName || 'Unassigned')}</td>
                <td>
                    <div class="row-actions">
                        <button class="icon-btn" type="button" data-action="edit-client" data-id="${escapeAttr(client.id)}">Edit</button>
                        <button class="icon-btn" type="button" data-action="call-client" data-id="${escapeAttr(client.id)}">Call</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function formatDateTime(value) {
    if (!value) return '—';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString();
}

function toDatetimeLocalValue(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const pad = (number) => String(number).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openClientModal(id = '') {
    const client = clients.find((item) => item.id === id) || {};
    const isEditing = Boolean(id);

    const callerOptions = me?.role === 'admin'
        ? `
            <label>
                Assign Caller
                <select name="assignedTo">
                    <option value="">Unassigned</option>
                    ${callers.map((caller) => `
                        <option value="${escapeAttr(caller.id)}" ${client.assignedTo === caller.id ? 'selected' : ''}>
                            ${escapeHtml(caller.name)}
                        </option>
                    `).join('')}
                </select>
            </label>
        `
        : '';

    $('modalContent').innerHTML = `
        <h2>${isEditing ? 'Edit Client' : 'Add Client'}</h2>

        <form id="clientForm">
            <div class="form-grid">

                <label>
                    Company
                    <input name="company" value="${escapeAttr(client.company || '')}">
                </label>

                <label>
                    Contact Person
                    <input name="contactName" value="${escapeAttr(client.contactName || '')}">
                </label>

                <label>
                    Phone
                    <input name="phone" value="${escapeAttr(client.phone || '')}">
                </label>

                <label>
                    Email
                    <input name="email" type="email" value="${escapeAttr(client.email || '')}">
                </label>

                <label>
                    Website
                    <input name="website" value="${escapeAttr(client.website || '')}">
                </label>

                <label>
                    LinkedIn
                    <input name="linkedin" value="${escapeAttr(client.linkedin || '')}">
                </label>

                <label>
                    Status
                    <select name="status">
                        ${statuses.map((status) => `
                            <option value="${escapeAttr(status)}" ${client.status === status ? 'selected' : ''}>
                                ${escapeHtml(status)}
                            </option>
                        `).join('')}
                    </select>
                </label>

                <label>
                    Next Follow-up
                    <input
                        name="nextFollowUp"
                        type="datetime-local"
                        value="${escapeAttr(toDatetimeLocalValue(client.nextFollowUp))}"
                    >
                </label>

                <label>
                    Deal Domain
                    <select name="dealDomain">
                        <option value="">Not closed / not selected</option>
                        ${domainOptions.map((domain) => `
                            <option value="${escapeAttr(domain)}" ${client.dealDomain === domain ? 'selected' : ''}>
                                ${escapeHtml(domain)}
                            </option>
                        `).join('')}
                    </select>
                </label>

                ${callerOptions}

                <label class="full">
                    Contacted Via
                    <div class="check-row">
                        ${channels.map((channel) => `
                            <label class="check">
                                <input
                                    type="checkbox"
                                    name="channel"
                                    value="${escapeAttr(channel)}"
                                    ${Array.isArray(client.contactChannels) && client.contactChannels.includes(channel) ? 'checked' : ''}
                                >
                                ${escapeHtml(channel)}
                            </label>
                        `).join('')}
                    </div>
                </label>

                <label class="full">
                    Address
                    <input name="address" value="${escapeAttr(client.address || '')}">
                </label>

                <label class="full">
                    Notes
                    <textarea name="notes">${escapeHtml(client.notes || '')}</textarea>
                </label>

            </div>

            <div class="form-actions">
                <button type="button" class="secondary" id="cancelClientButton">Cancel</button>
                <button type="submit" class="primary" id="saveClientButton">
                    Save Client
                </button>
            </div>
        </form>
    `;

    $('modal').classList.remove('hidden');
    $('cancelClientButton').onclick = closeModal;

    $('clientForm').onsubmit = async (event) => {
        event.preventDefault();

        const submitButton = $('saveClientButton');
        setButtonBusy(submitButton, true, 'Saving...');

        const form = new FormData(event.target);
        const data = Object.fromEntries(form.entries());
        data.contactChannels = form.getAll('channel');

        try {
            await api(isEditing ? `/api/clients/${encodeURIComponent(id)}` : '/api/clients', {
                method: isEditing ? 'PATCH' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            closeModal();
            lastClientRequestKey = '';

            await Promise.all([
                loadClients({ force: true }),
                loadDashboard(),
                loadFollowups({ silent: true })
            ]);
        } catch (error) {
            showError(error);
        } finally {
            setButtonBusy(submitButton, false);
        }
    };
}

function openCallModal(id) {
    const client = clients.find((item) => item.id === id);

    if (!client) {
        alert('Client not found. Refresh the lead list and try again.');
        return;
    }

    $('modalContent').innerHTML = `
        <h2>Log Call — ${escapeHtml(client.company || client.phone || 'Client')}</h2>

        <form id="callForm" enctype="multipart/form-data">

            <label>
                Outcome
                <select name="outcome">
                    ${statuses.map((status) => `<option value="${escapeAttr(status)}">${escapeHtml(status)}</option>`).join('')}
                </select>
            </label>

            <label>
                Next Follow-up
                <input name="nextFollowUp" type="datetime-local">
            </label>

            <label>
                Call Duration
                <input name="duration" placeholder="e.g. 03:42">
            </label>

            <label>
                Notes
                <textarea name="notes" placeholder="What happened on the call?"></textarea>
            </label>

            <label>
                Recording File
                <input name="recording" type="file" accept="audio/*">
            </label>

            <div class="form-actions">
                <button type="button" class="secondary" id="cancelCallButton">Cancel</button>
                <button type="submit" class="primary" id="saveCallButton">Save Call</button>
            </div>

        </form>
    `;

    $('modal').classList.remove('hidden');
    $('cancelCallButton').onclick = closeModal;

    $('callForm').onsubmit = async (event) => {
        event.preventDefault();

        const submitButton = $('saveCallButton');
        setButtonBusy(submitButton, true, 'Saving Call...');

        const formData = new FormData(event.target);
        formData.append('clientId', id);
        formData.append('channel', 'Call');

        try {
            await api('/api/calls', {
                method: 'POST',
                body: formData
            });

            closeModal();
            lastClientRequestKey = '';

            await Promise.all([
                loadClients({ force: true }),
                loadDashboard(),
                loadFollowups({ silent: true })
            ]);
        } catch (error) {
            showError(error);
        } finally {
            setButtonBusy(submitButton, false);
        }
    };
}

async function loadAllCalls() {
    const container = $('allCalls');
    if (!container) return;

    setLoading(container, 'Loading call recordings...');

    try {
        // Optimized endpoint: one request instead of one request per client.
        const data = await api('/api/calls');
        const calls = Array.isArray(data) ? data : [];

        if (!calls.length) {
            container.innerHTML = '<div class="muted">No call recordings yet.</div>';
            return;
        }

        container.innerHTML = calls.map((call) => `
            <div class="call-item">
                <div class="call-meta">
                    ${escapeHtml(formatDateTime(call.createdAt))}
                    · ${escapeHtml(call.client?.company || call.client?.phone || 'Unknown client')}
                    · ${escapeHtml(call.outcome || 'No outcome')}
                    · ${escapeHtml(call.callerName || 'Unknown caller')}
                </div>

                ${call.notes ? `<div>${escapeHtml(call.notes)}</div>` : ''}

                ${call.recordingUrl
                    ? `<audio controls preload="none" src="${escapeAttr(call.recordingUrl)}" style="width:100%;margin-top:8px"></audio>`
                    : '<div class="muted" style="margin-top:8px">No recording</div>'
                }
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
    }
}

async function loadCallers() {
    if (me?.role !== 'admin') {
        return;
    }

    const container = $('callerList');
    setLoading(container, 'Loading caller accounts...');

    try {
        await ensureCallers(true);

        if (!callers.length) {
            container.innerHTML = '<div class="muted">No callers yet.</div>';
            return;
        }

        container.innerHTML = callers.map((caller) => `
            <div class="caller-row">
                <div>
                    <b>${escapeHtml(caller.name)}</b>
                    <div class="muted">
                        ${escapeHtml(caller.email)} · ${caller.active ? 'Active' : 'Disabled'}
                    </div>
                </div>

                <div class="caller-actions">
                    <button
                        class="icon-btn"
                        type="button"
                        data-action="reset-caller"
                        data-id="${escapeAttr(caller.id)}"
                    >
                        Reset Password
                    </button>

                    <button
                        class="icon-btn"
                        type="button"
                        data-action="toggle-caller"
                        data-id="${escapeAttr(caller.id)}"
                        data-active="${caller.active ? 'true' : 'false'}"
                    >
                        ${caller.active ? 'Disable' : 'Enable'}
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
    }
}

function openCallerModal() {
    $('modalContent').innerHTML = `
        <h2>Add Caller</h2>

        <form id="callerForm">

            <label>
                Name
                <input name="name" required>
            </label>

            <label>
                Email
                <input name="email" type="email" required>
            </label>

            <label>
                Password
                <input name="password" type="password" required minlength="6">
            </label>

            <div class="form-actions">
                <button type="button" class="secondary" id="cancelCallerButton">Cancel</button>
                <button type="submit" class="primary" id="createCallerButton">Create Caller</button>
            </div>

        </form>
    `;

    $('modal').classList.remove('hidden');
    $('cancelCallerButton').onclick = closeModal;

    $('callerForm').onsubmit = async (event) => {
        event.preventDefault();

        const submitButton = $('createCallerButton');
        setButtonBusy(submitButton, true, 'Creating...');

        try {
            await api('/api/callers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
            });

            closeModal();
            callerCacheLoaded = false;
            await loadCallers();
        } catch (error) {
            showError(error);
        } finally {
            setButtonBusy(submitButton, false);
        }
    };
}

async function resetCaller(id) {
    const password = prompt('New password (6+ chars):');
    if (!password) return;

    if (password.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
    }

    try {
        await api(`/api/callers/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        alert('Password updated.');
    } catch (error) {
        showError(error);
    }
}

async function toggleCaller(id, active) {
    try {
        await api(`/api/callers/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ active: !active })
        });

        callerCacheLoaded = false;
        await loadCallers();
    } catch (error) {
        showError(error);
    }
}

async function uploadLogo(event) {
    event.preventDefault();

    const file = $('logoFile')?.files?.[0];
    if (!file) {
        alert('Please select a logo image.');
        return;
    }

    const submitButton = $('logoForm')?.querySelector('button[type="submit"]');
    setButtonBusy(submitButton, true, 'Uploading...');

    const formData = new FormData();
    formData.append('logo', file);

    try {
        await api('/api/settings/logo', {
            method: 'POST',
            body: formData
        });

        await loadLogo();
        $('logoFile').value = '';
        alert('Agency logo updated.');
    } catch (error) {
        showError(error);
    } finally {
        setButtonBusy(submitButton, false);
    }
}

async function removeLogo() {
    try {
        await api('/api/settings/logo', {
            method: 'DELETE'
        });

        await loadLogo();
        alert('Agency logo removed.');
    } catch (error) {
        showError(error);
    }
}

function closeModal() {
    $('modal')?.classList.add('hidden');
}

// =========================
// EVENT HANDLERS
// =========================

$('forgotPasswordBtn')?.addEventListener('click', () => {
    showResetCard();
});

$('backToLoginBtn')?.addEventListener('click', () => {
    showLoginCard();
});

$('forgotPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await requestPasswordReset();
});

$('completeResetForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await completePasswordReset();
});

$('resendResetCodeBtn')?.addEventListener('click', async () => {
    await requestPasswordReset();
});

$('resetCode')?.addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
});

$('loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = event.target.querySelector('button[type="submit"]');
    setButtonBusy(button, true, 'Signing in...');

    try {
        await api('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: $('email').value.trim(),
                password: $('password').value
            })
        });

        await boot();
    } catch (error) {
        showError(error, 'Unable to sign in.');
    } finally {
        setButtonBusy(button, false);
    }
});

$('logout')?.addEventListener('click', async () => {
    try {
        await api('/api/logout', {
            method: 'POST'
        });
    } catch (error) {
        console.warn('Logout request failed:', error);
    } finally {
        window.location.reload();
    }
});

document.querySelectorAll('nav button').forEach((button) => {
    button.addEventListener('click', () => {
        showView(button.dataset.view).catch(showError);
    });
});

$('newClientBtn')?.addEventListener('click', () => openClientModal());
$('refreshFollowupsBtn')?.addEventListener('click', () => loadFollowups().catch(showError));
$('enableFollowupNotificationsBtn')?.addEventListener('click', enableFollowupNotifications);
$('closeModal')?.addEventListener('click', closeModal);
$('logoForm')?.addEventListener('submit', uploadLogo);
$('removeLogoBtn')?.addEventListener('click', removeLogo);
$('newCallerBtn')?.addEventListener('click', () => {
    if (me?.role !== 'admin') {
        showError(new Error('Only administrators can create caller accounts.'));
        return;
    }

    openCallerModal();
});
$('importBtn')?.addEventListener('click', () => $('excelFile')?.click());

$('excelFile')?.addEventListener('change', async () => {
    const file = $('excelFile')?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const button = $('importBtn');
    setButtonBusy(button, true, 'Importing...');

    try {
        const result = await api('/api/import/excel', {
            method: 'POST',
            body: formData
        });

        alert(
            `Imported ${result.imported || 0} leads out of ${result.totalRows || 0} rows.\n\n` +
            (me?.role === 'caller'
                ? 'These leads are assigned to your account.'
                : 'Admin imports use the Excel Caller column when provided; otherwise the leads remain unassigned and visible to callers.')
        );

        lastClientRequestKey = '';

        await Promise.all([
            loadClients({ force: true }),
            loadDashboard(),
            loadFollowups({ silent: true })
        ]);
    } catch (error) {
        showError(error, 'Could not import the Excel file.');
    } finally {
        $('excelFile').value = '';
        setButtonBusy(button, false);
    }
});

$('search')?.addEventListener('input', scheduleClientSearch);
$('statusFilter')?.addEventListener('change', () => loadClients({ force: true }).catch(showError));
$('callerFilter')?.addEventListener('change', () => loadClients({ force: true }).catch(showError));

$('clientsBody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const { action, id } = button.dataset;

    if (action === 'edit-client') openClientModal(id);
    if (action === 'call-client') openCallModal(id);
});

$('followupList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-followup-action]');
    if (!button) return;

    const { id, followupAction } = button.dataset;
    if (followupAction === 'call') openCallModal(id);
    if (followupAction === 'edit') openClientModal(id);
});

$('callerList')?.addEventListener('click', (event) => {
    if (me?.role !== 'admin') {
        return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const { action, id, active } = button.dataset;

    if (action === 'reset-caller') resetCaller(id);
    if (action === 'toggle-caller') toggleCaller(id, active === 'true');
});

$('modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'modal') closeModal();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('modal')?.classList.contains('hidden')) {
        closeModal();
    }
});

window.openClientModal = openClientModal;
window.openCallModal = openCallModal;
window.closeModal = closeModal;
window.resetCaller = resetCaller;
window.toggleCaller = toggleCaller;

setInterval(() => {
    if (me) loadFollowups({ silent: true }).catch(() => {});
}, 60000);

boot();
