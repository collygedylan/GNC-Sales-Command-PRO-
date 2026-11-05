(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GncManagerSourceLiveEvents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const surfaces = Object.freeze({
        'company-directory': Object.freeze({ view: 'managers', sources: Object.freeze(['ph_company_directory_contacts', 'ph_company_directory_blocks', 'ph_company_directory_beds', 'ph_company_directory_codes']) }),
        'production-schedule': Object.freeze({ view: 'managers', sources: Object.freeze(['production_schedule_active']) }),
        'hr-command': Object.freeze({ view: 'managers', sources: Object.freeze(['core_employees', 'hr_job_codes', 'labor_timesheets', 'ph_department_calendar_events']) }),
        'communications-chat': Object.freeze({ view: 'communication', sources: Object.freeze(['ph_chat_conversations', 'ph_chat_participants', 'ph_chat_messages']) }),
        'communications-calendar': Object.freeze({ view: 'communication', sources: Object.freeze(['ph_department_calendar_events']) })
    });

    function dispatch(target, state) {
        if (!target || typeof target.dispatchEvent !== 'function' || !state || state.authorized !== true
            || state.visible !== true || !Object.prototype.hasOwnProperty.call(surfaces, state.tab)) return false;
        const surface = surfaces[state.tab];
        if (state.view !== surface.view) return false;
        const allowed = surface.sources;
        const sources = Array.from(new Set(Array.isArray(state.sources) ? state.sources.map(String) : []));
        if (!sources.length || sources.some(source => !allowed.includes(source))) return false;
        const EventClass = target.CustomEvent || target.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof EventClass !== 'function') return false;
        target.dispatchEvent(new EventClass('gnc-manager-source-revision', {
            detail: Object.freeze({ surface: state.tab, sources: Object.freeze(sources) })
        }));
        return true;
    }

    function sourcesFor(tab) { return surfaces[tab] ? surfaces[tab].sources.slice() : []; }
    return Object.freeze({ dispatch, sourcesFor });
});
