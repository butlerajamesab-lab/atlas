/**
 * Open States adapter wrapped as a BaseAdapter subclass for use by the schema engine.
 */

import { ConnectorConfig } from '../../types';
import { BaseAdapter } from '../baseAdapter';
import { fetchStatutes, normalizeToStatute } from '../../adapters/openStatesAdapter';

export class OpenStatesBaseAdapter extends BaseAdapter {
  constructor(config: ConnectorConfig) {
    super(config);
  }

  async fetch(params: Record<string, any>): Promise<any[]> {
    const jurisdiction: string = params['jurisdiction'] ?? 'wa';
    const session: string | undefined = params['session'];
    const apiKey: string =
      params['apiKey'] ?? process.env['OPEN_STATES_API_KEY'] ?? '';

    if (!apiKey) {
      throw new Error('OPEN_STATES_API_KEY is required');
    }

    const all: any[] = [];
    let page = 1;
    let maxPage = 1;

    do {
      const { bills, pagination } = await fetchStatutes(jurisdiction, apiKey, session, page);
      all.push(...bills);
      maxPage = pagination.max_page;
      page++;
    } while (page <= maxPage);

    return all;
  }

  normalize(raw: any, ingestJobId: string): Record<string, unknown> {
    const jurisdiction = raw?.jurisdiction ?? 'wa';
    return normalizeToStatute(raw, jurisdiction, ingestJobId);
  }

  protected getTargetTable(): string {
    return 'statutes';
  }

  protected getConflictKey(): string {
    return 'citation';
  }

  protected extractSourceUrl(raw: any): string {
    return raw?.openstates_url ?? '';
  }
}
