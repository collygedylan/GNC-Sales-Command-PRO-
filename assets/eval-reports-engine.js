(function attachGncEvalReports(root) {
    'use strict';

    const REPORT_IDS = Object.freeze([
        's1-with-pri',
        'od-loc-note-date',
        'hs-plus-5-days',
        'get-off-hold',
        'low-stock',
        'no-pri',
        'culls',
        'not-in-f1'
    ]);
    const REPORT_META = Object.freeze({
        's1-with-pri': Object.freeze({ label: 'S1WithPRI', description: 'Priority rows in the configured current season.' }),
        'od-loc-note-date': Object.freeze({ label: 'ODLocNoteDate', description: 'Rows whose location-note date is older than the configured limit.' }),
        'hs-plus-5-days': Object.freeze({ label: 'HS+5days', description: 'Rows whose hold-start date is older than the configured limit.' }),
        'get-off-hold': Object.freeze({ label: 'GEToffHold', description: 'ItemCodes with an old hold-start and rows that have no hold/stop code.' }),
        'low-stock': Object.freeze({ label: 'LowStock', description: 'Supporting rows for low-stock ItemCodes in the configured current season.' }),
        'no-pri': Object.freeze({ label: 'NoPRI', description: 'ItemCodes with no Priority on any row.' }),
        'culls': Object.freeze({ label: 'Culls', description: 'Rows in Season X.' }),
        'not-in-f1': Object.freeze({ label: 'NotInF1', description: 'ItemCodes with no valid F1 row through the configured sales year.' })
    });
    const DEFAULT_SETTINGS = Object.freeze({
        lowStockMaxSLts: 150,
        holdAgeDays: 5,
        locationNoteAgeDays: 10
    });
    const SEASON_ORDER = Object.freeze(['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z']);

    function firstValue(row, keys, fallback) {
        const source = row && typeof row === 'object' ? row : {};
        for (let index = 0; index < keys.length; index += 1) {
            const value = source[keys[index]];
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return fallback;
    }

    function textValue(row, keys) {
        const value = firstValue(row, keys, '');
        return String(value == null ? '' : value).trim();
    }

    function normalizeItemCode(row) {
        return textValue(row, ['ITEMCODE', 'itemcode']).toUpperCase();
    }

    function normalizeSeason(row) {
        return textValue(row, ['SEASON', 'season']).toUpperCase().replace(/\s+/g, '');
    }

    function normalizeSalesYear(value) {
        const numeric = Number(String(value == null ? '' : value).replace(/,/g, '').trim());
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        const rounded = Math.round(numeric);
        if (rounded >= 1 && rounded <= 99) return 2000 + rounded;
        return rounded;
    }

    function normalizeConfiguredSalesYear(value) {
        const normalized = normalizeSalesYear(value);
        return normalized == null ? 2027 : normalized;
    }

    function normalizeNumber(value, fallback) {
        const raw = String(value == null ? '' : value).replace(/,/g, '').trim();
        if (!raw) return fallback;
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normalizeSettings(value) {
        const source = value && typeof value === 'object' ? value : {};
        const lowStockMaxSLts = normalizeNumber(
            firstValue(source, ['lowStockMaxSLts', 'low_stock_max_slts'], DEFAULT_SETTINGS.lowStockMaxSLts),
            DEFAULT_SETTINGS.lowStockMaxSLts
        );
        const holdAgeDays = Math.round(normalizeNumber(
            firstValue(source, ['holdAgeDays', 'hold_age_days'], DEFAULT_SETTINGS.holdAgeDays),
            DEFAULT_SETTINGS.holdAgeDays
        ));
        const locationNoteAgeDays = Math.round(normalizeNumber(
            firstValue(source, ['locationNoteAgeDays', 'location_note_age_days'], DEFAULT_SETTINGS.locationNoteAgeDays),
            DEFAULT_SETTINGS.locationNoteAgeDays
        ));
        return {
            lowStockMaxSLts: Math.min(100000000, Math.max(0, lowStockMaxSLts)),
            holdAgeDays: Math.min(3650, Math.max(0, holdAgeDays)),
            locationNoteAgeDays: Math.min(3650, Math.max(0, locationNoteAgeDays))
        };
    }

    function getCentralDateParts(now) {
        const date = now instanceof Date ? now : new Date(now || Date.now());
        const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Chicago',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            });
            const parts = formatter.formatToParts(safeDate).reduce((acc, part) => {
                if (part.type === 'year' || part.type === 'month' || part.type === 'day') acc[part.type] = Number(part.value);
                return acc;
            }, {});
            if (parts.year && parts.month && parts.day) return parts;
        } catch (error) {}
        return { year: safeDate.getFullYear(), month: safeDate.getMonth() + 1, day: safeDate.getDate() };
    }

    function toEpochDay(year, month, day) {
        const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
        const value = new Date(stamp);
        if (Number.isNaN(stamp)
            || value.getUTCFullYear() !== Number(year)
            || value.getUTCMonth() + 1 !== Number(month)
            || value.getUTCDate() !== Number(day)) return null;
        return Math.floor(stamp / 86400000);
    }

    function parseInventoryDateEpochDay(value) {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return null;
        let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D|$)/);
        let year;
        let month;
        let day;
        if (match) {
            month = Number(match[1]);
            day = Number(match[2]);
            year = Number(match[3]);
            if (year >= 0 && year <= 99) year += 2000;
            return toEpochDay(year, month, day);
        }
        match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/);
        if (!match) return null;
        return toEpochDay(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    function isOlderThanDays(value, thresholdDays, todayEpochDay) {
        const rowDay = parseInventoryDateEpochDay(value);
        return rowDay != null && todayEpochDay - rowDay > Number(thresholdDays || 0);
    }

    function getRowSalesYear(row) {
        return normalizeSalesYear(firstValue(row, ['SALEYEAR', 'saleyear', 'SALESYEAR', 'salesyear'], ''));
    }

    function getRowSLts(row) {
        return normalizeNumber(firstValue(row, ['S_LTS', 's_lts'], ''), 0);
    }

    function getAssignedTo(row) {
        return textValue(row, ['ASSIGNEDTO', 'assignedto']);
    }

    function getPriority(row) {
        return textValue(row, ['PRIORITY', 'priority']);
    }

    function getHoldStart(row) {
        return textValue(row, ['HOLDSTOPBEGINDATE', 'holdstopbegindate']);
    }

    function getHoldStopCode(row) {
        return textValue(row, ['HOLDSTOPCODE', 'holdstopcode', 'HOLSTOPCODE', 'holstopcode']);
    }

    function getLocationNoteDate(row) {
        return textValue(row, ['LOCATIONNOTEDATE', 'locationnotedate']);
    }

    function compareText(left, right) {
        const leftText = String(left || '').trim().toLowerCase();
        const rightText = String(right || '').trim().toLowerCase();
        if (leftText < rightText) return -1;
        if (leftText > rightText) return 1;
        return 0;
    }

    function compareRows(left, right) {
        let result = compareText(getAssignedTo(left), getAssignedTo(right));
        if (result) return result;
        result = compareText(normalizeItemCode(left), normalizeItemCode(right));
        if (result) return result;
        const leftSeason = normalizeSeason(left);
        const rightSeason = normalizeSeason(right);
        const leftRank = SEASON_ORDER.indexOf(leftSeason);
        const rightRank = SEASON_ORDER.indexOf(rightSeason);
        result = (leftRank < 0 ? SEASON_ORDER.length : leftRank) - (rightRank < 0 ? SEASON_ORDER.length : rightRank);
        if (result) return result;
        const leftYear = getRowSalesYear(left);
        const rightYear = getRowSalesYear(right);
        if (leftYear == null && rightYear != null) return 1;
        if (leftYear != null && rightYear == null) return -1;
        if (leftYear !== rightYear) return Number(leftYear || 0) - Number(rightYear || 0);
        return compareText(textValue(left, ['LOCATIONCODE', 'locationcode']), textValue(right, ['LOCATIONCODE', 'locationcode']));
    }

    function classifyRows(rows, options) {
        const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        const config = options && typeof options === 'object' ? options : {};
        const settings = normalizeSettings(config.settings);
        const currentSeason = String(config.currentSeason || 'F1').trim().toUpperCase() || 'F1';
        const currentSalesYear = normalizeConfiguredSalesYear(config.currentSalesYear);
        const configuredYearCode = currentSalesYear % 100;
        const nextSeason = String(config.nextSeason || (currentSeason === 'F1' ? 'S1' : 'F1')).trim().toUpperCase();
        const nextSalesYear = normalizeConfiguredSalesYear(
            config.nextSalesYear == null ? (currentSeason === 'F1' ? configuredYearCode : configuredYearCode + 1) : config.nextSalesYear
        );
        const todayParts = getCentralDateParts(config.now);
        const todayEpochDay = toEpochDay(todayParts.year, todayParts.month, todayParts.day);
        const aggregates = new Map();
        const rowMetadata = new Map();

        sourceRows.forEach((row) => {
            const itemCode = normalizeItemCode(row);
            if (!itemCode) return;
            const season = normalizeSeason(row);
            const salesYear = getRowSalesYear(row);
            const priority = getPriority(row);
            const metadata = {
                itemCode,
                season,
                salesYear,
                priority,
                assignedTo: getAssignedTo(row),
                holdStopCode: getHoldStopCode(row),
                location: textValue(row, ['LOCATIONCODE', 'locationcode']),
                oldHold: isOlderThanDays(getHoldStart(row), settings.holdAgeDays, todayEpochDay),
                oldLocationNote: isOlderThanDays(getLocationNoteDate(row), settings.locationNoteAgeDays, todayEpochDay),
                slts: getRowSLts(row)
            };
            rowMetadata.set(row, metadata);
            if (!aggregates.has(itemCode)) {
                aggregates.set(itemCode, {
                    hasPriority: false,
                    hasValidF1: false,
                    hasOldHold: false,
                    hasLowStockCurrent: false
                });
            }
            const aggregate = aggregates.get(itemCode);
            const validThroughCurrent = salesYear != null && salesYear > 0 && salesYear <= currentSalesYear;
            if (priority) aggregate.hasPriority = true;
            if (season === 'F1' && validThroughCurrent) aggregate.hasValidF1 = true;
            if (metadata.oldHold) aggregate.hasOldHold = true;
            if (season === currentSeason && validThroughCurrent && metadata.slts < settings.lowStockMaxSLts) {
                aggregate.hasLowStockCurrent = true;
            }
        });

        const reports = REPORT_IDS.reduce((acc, reportId) => {
            acc[reportId] = [];
            return acc;
        }, {});
        const supportSeasons = new Set(['U1', 'U2', 'U3', 'X']);

        sourceRows.forEach((row) => {
            const metadata = rowMetadata.get(row);
            if (!metadata) return;
            const itemCode = metadata.itemCode;
            if (!itemCode || !aggregates.has(itemCode)) return;
            const aggregate = aggregates.get(itemCode);
            const season = metadata.season;
            const salesYear = metadata.salesYear;
            const validThroughCurrent = salesYear != null && salesYear > 0 && salesYear <= currentSalesYear;
            const isNextTarget = season === nextSeason && salesYear === nextSalesYear;

            if (metadata.priority && season === currentSeason) reports['s1-with-pri'].push(row);
            if (metadata.oldLocationNote) reports['od-loc-note-date'].push(row);
            if (metadata.oldHold) reports['hs-plus-5-days'].push(row);
            if (aggregate.hasOldHold && !metadata.holdStopCode) reports['get-off-hold'].push(row);
            if (aggregate.hasLowStockCurrent && ((supportSeasons.has(season) && validThroughCurrent) || isNextTarget)) reports['low-stock'].push(row);
            if (!aggregate.hasPriority) reports['no-pri'].push(row);
            if (season === 'X') reports.culls.push(row);
            if (!aggregate.hasValidF1) reports['not-in-f1'].push(row);
        });

        const compareClassifiedRows = (left, right) => {
            const leftMeta = rowMetadata.get(left);
            const rightMeta = rowMetadata.get(right);
            let result = compareText(leftMeta.assignedTo, rightMeta.assignedTo);
            if (result) return result;
            result = compareText(leftMeta.itemCode, rightMeta.itemCode);
            if (result) return result;
            const leftRank = SEASON_ORDER.indexOf(leftMeta.season);
            const rightRank = SEASON_ORDER.indexOf(rightMeta.season);
            result = (leftRank < 0 ? SEASON_ORDER.length : leftRank) - (rightRank < 0 ? SEASON_ORDER.length : rightRank);
            if (result) return result;
            if (leftMeta.salesYear == null && rightMeta.salesYear != null) return 1;
            if (leftMeta.salesYear != null && rightMeta.salesYear == null) return -1;
            if (leftMeta.salesYear !== rightMeta.salesYear) return Number(leftMeta.salesYear || 0) - Number(rightMeta.salesYear || 0);
            return compareText(leftMeta.location, rightMeta.location);
        };
        REPORT_IDS.forEach((reportId) => reports[reportId].sort(compareClassifiedRows));
        const counts = REPORT_IDS.reduce((acc, reportId) => {
            acc[reportId] = reports[reportId].length;
            return acc;
        }, {});
        return {
            reports,
            counts,
            aggregates,
            settings,
            currentSeason,
            currentSalesYear,
            nextSeason,
            nextSalesYear,
            centralDateKey: `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
        };
    }

    root.GncEvalReports = Object.freeze({
        REPORT_IDS,
        REPORT_META,
        DEFAULT_SETTINGS,
        SEASON_ORDER,
        normalizeSalesYear,
        normalizeSettings,
        parseInventoryDateEpochDay,
        getCentralDateParts,
        compareRows,
        classifyRows
    });
})(typeof window !== 'undefined' ? window : globalThis);
