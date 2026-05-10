"use strict";
/**
 * Open States adapter wrapped as a BaseAdapter subclass for use by the schema engine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenStatesBaseAdapter = void 0;
const baseAdapter_1 = require("../baseAdapter");
const openStatesAdapter_1 = require("../../adapters/openStatesAdapter");
class OpenStatesBaseAdapter extends baseAdapter_1.BaseAdapter {
    constructor(config) {
        super(config);
    }
    async fetch(params) {
        const jurisdiction = params['jurisdiction'] ?? 'wa';
        const session = params['session'];
        const apiKey = params['apiKey'] ?? process.env['OPEN_STATES_API_KEY'] ?? '';
        if (!apiKey) {
            throw new Error('OPEN_STATES_API_KEY is required');
        }
        const all = [];
        let page = 1;
        let maxPage = 1;
        do {
            const { bills, pagination } = await (0, openStatesAdapter_1.fetchStatutes)(jurisdiction, apiKey, session, page);
            all.push(...bills);
            maxPage = pagination.max_page;
            page++;
        } while (page <= maxPage);
        return all;
    }
    normalize(raw, ingestJobId) {
        const jurisdiction = raw?.jurisdiction ?? 'wa';
        return (0, openStatesAdapter_1.normalizeToStatute)(raw, jurisdiction, ingestJobId);
    }
    getTargetTable() {
        return 'statutes';
    }
    getConflictKey() {
        return 'citation';
    }
    extractSourceUrl(raw) {
        return raw?.openstates_url ?? '';
    }
}
exports.OpenStatesBaseAdapter = OpenStatesBaseAdapter;
//# sourceMappingURL=openStatesBaseAdapter.js.map