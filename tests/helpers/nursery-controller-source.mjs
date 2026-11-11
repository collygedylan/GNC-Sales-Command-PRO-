import { readFileSync } from 'node:fs';

export function readNurseryControllerSource() {
    const names = ['nursery-excel-context','nursery-table-render','nursery-table-controller','nursery-command-tables'];
    return names.map(name => readFileSync(new URL('../../assets/' + name + '.js',import.meta.url),'utf8')).join('\n');
}
