/**
 * Open States adapter wrapped as a BaseAdapter subclass for use by the schema engine.
 */
import { ConnectorConfig } from '../../types';
import { BaseAdapter } from '../baseAdapter';
export declare class OpenStatesBaseAdapter extends BaseAdapter {
    constructor(config: ConnectorConfig);
    fetch(params: Record<string, any>): Promise<any[]>;
    normalize(raw: any, ingestJobId: string): Record<string, unknown>;
    protected getTargetTable(): string;
    protected getConflictKey(): string;
    protected extractSourceUrl(raw: any): string;
}
//# sourceMappingURL=openStatesBaseAdapter.d.ts.map