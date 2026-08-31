(function attachGncEvalReports(root) {
    'use strict';

    const REPORT_IDS = Object.freeze([
        's1-with-pri',
        'u1',
        'u2',
        'u3',
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
        'u1': Object.freeze({ label: 'U1', description: 'Rows whose Season is U1.' }),
        'u2': Object.freeze({ label: 'U2', description: 'Rows whose Season is U2.' }),
        'u3': Object.freeze({ label: 'U3', description: 'Rows whose Season is U3.' }),
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
    const ITEM_INQUIRY_FIELD_GROUPS = Object.freeze({
        item: Object.freeze([
            'PLANTGROUPCODE', 'COMMONNAME', 'CONTSIZE', 'ITEMCODE',
            'GENUSNAME', 'FIELDTAGCOLOR', 'ITEMSPEC', 'PULLERRESPONSIBILITY'
        ]),
        season: Object.freeze([
            'SALEYEAR', 'SEASON', 'S_LTS', 'SEASON_SUPPLY', 'SEASON_OH', 'SEASON_DEMAND'
        ]),
        location: Object.freeze([
            'LOTCODE', 'LOCATIONCODE', 'SOURCE', 'PRIORITY', 'PTRONHAND', 'PTRAVAILABLE',
            'HOLDSTOPCODE', 'HOLDSTOPBEGINDATE', 'HOLDSTOPREASON', 'HSREASONBEGIN',
            'LOCATIONNOTE', 'LOCATIONNOTEDATE', 'SUSPEND', 'SUSPENDTO',
            'SPECIALPULLER', 'PULLTAGNOTE1'
        ])
    });
    const ITEM_INQUIRY_FIELD_ALIASES = Object.freeze({
        PLANTGROUPCODE: Object.freeze(['PLANTGROUPCODE', 'plantgroupcode']),
        COMMONNAME: Object.freeze(['COMMONNAME', 'commonname']),
        CONTSIZE: Object.freeze(['CONTSIZE', 'contsize']),
        ITEMCODE: Object.freeze(['ITEMCODE', 'itemcode']),
        GENUSNAME: Object.freeze(['GENUSNAME', 'genusname']),
        FIELDTAGCOLOR: Object.freeze(['FIELDTAGCOLOR', 'fieldtagcolor', 'FIELD_TAG_COLOR', 'field_tag_color']),
        ITEMSPEC: Object.freeze(['ITEMSPEC', 'itemspec']),
        PULLERRESPONSIBILITY: Object.freeze(['PULLERRESPONSIBILITY', 'pullerresponsibility']),
        SALEYEAR: Object.freeze(['SALEYEAR', 'saleyear', 'SALESYEAR', 'salesyear']),
        SEASON: Object.freeze(['SEASON', 'season']),
        S_LTS: Object.freeze(['S_LTS', 's_lts']),
        SEASON_SUPPLY: Object.freeze(['SEASON_SUPPLY', 'season_supply']),
        SEASON_OH: Object.freeze(['SEASON_OH', 'season_oh']),
        SEASON_DEMAND: Object.freeze(['SEASON_DEMAND', 'season_demand']),
        LOTCODE: Object.freeze(['LOTCODE', 'lotcode']),
        LOCATIONCODE: Object.freeze(['LOCATIONCODE', 'locationcode']),
        SOURCE: Object.freeze(['SOURCE', 'source']),
        PRIORITY: Object.freeze(['PRIORITY', 'priority']),
        PTRONHAND: Object.freeze(['PTRONHAND', 'ptronhand']),
        PTRAVAILABLE: Object.freeze(['PTRAVAILABLE', 'ptravailable']),
        HOLDSTOPCODE: Object.freeze(['HOLDSTOPCODE', 'holdstopcode', 'HOLSTOPCODE', 'holstopcode']),
        HOLDSTOPBEGINDATE: Object.freeze(['HOLDSTOPBEGINDATE', 'holdstopbegindate']),
        HOLDSTOPREASON: Object.freeze(['HOLDSTOPREASON', 'holdstopreason']),
        HSREASONBEGIN: Object.freeze(['HSREASONBEGIN', 'hsreasonbegin']),
        LOCATIONNOTE: Object.freeze(['LOCATIONNOTE', 'locationnote']),
        LOCATIONNOTEDATE: Object.freeze(['LOCATIONNOTEDATE', 'locationnotedate']),
        SUSPEND: Object.freeze(['SUSPEND', 'suspend']),
        SUSPENDTO: Object.freeze(['SUSPENDTO', 'suspendto', 'SUSPEND_TO', 'suspend_to']),
        SPECIALPULLER: Object.freeze(['SPECIALPULLER', 'specialpuller']),
        PULLTAGNOTE1: Object.freeze(['PULLTAGNOTE1', 'pulltagnote1'])
    });
    const UNASSIGNED_INQUIRY_LABEL = '(Unassigned)';

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
        return textValue(row, ['ITEMCODE', 'itemcode', 'itemcode_normalized']).toUpperCase();
    }

    function normalizeAssignmentGenus(row) {
        return textValue(row, ['GENUSNAME', 'genusname', 'genusname_normalized', 'GENUS_NAME', 'genus_name'])
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    function buildAuthoritativeAssignmentKey(row) {
        const itemCode = normalizeItemCode(row);
        if (!itemCode) return '';
        return `${itemCode}|${normalizeAssignmentGenus(row)}`;
    }

    function normalizeAssignmentIdentityValue(row, keys) {
        return textValue(row, keys).toUpperCase().replace(/\s+/g, ' ');
    }

    function buildAuthoritativeAssignmentExactKey(row) {
        const itemCode = normalizeItemCode(row);
        const contSize = normalizeAssignmentIdentityValue(row, ['CONTSIZE', 'contsize']);
        const locationCode = normalizeAssignmentIdentityValue(row, ['LOCATIONCODE', 'locationcode']);
        if (!itemCode || !contSize || !locationCode) return '';
        return `${itemCode}|${contSize}|${locationCode}`;
    }

    function getAuthoritativeAssignmentLookupKeys(row) {
        // ph_warehouse_assigned_items is uniquely authoritative at
        // ITEMCODE + GENUSNAME. Its container and location columns are sample
        // display values populated with max(...), not assignment boundaries.
        return [buildAuthoritativeAssignmentKey(row)].filter(Boolean);
    }

    function buildAuthoritativeAssignmentModel(inventoryRows, assignmentRows) {
        const sourceInventory = Array.isArray(inventoryRows) ? inventoryRows.filter(Boolean) : [];
        const sourceAssignments = Array.isArray(assignmentRows) ? assignmentRows.filter(Boolean) : [];
        const assignmentByKey = new Map();
        const assignedNames = new Map();
        let hasUnassigned = false;

        sourceAssignments.forEach((row) => {
            // The database assignment contract is ITEMCODE + GENUSNAME. Do not
            // reinterpret the row's sample CONTSIZE/LOCATIONCODE as ownership.
            const key = buildAuthoritativeAssignmentKey(row);
            if (!key) return;
            const assignedTo = getAssignedTo(row);
            if (!assignmentByKey.has(key)) assignmentByKey.set(key, new Map());
            const normalizedAssignment = assignedTo ? assignedTo.toLowerCase() : '__unassigned__';
            if (!assignmentByKey.get(key).has(normalizedAssignment)) assignmentByKey.get(key).set(normalizedAssignment, assignedTo);
            if (!assignedTo) {
                hasUnassigned = true;
                return;
            }
            const normalizedName = assignedTo.toLowerCase();
            if (!assignedNames.has(normalizedName)) assignedNames.set(normalizedName, assignedTo);
        });

        let matchedCount = 0;
        let unassignedCount = 0;
        const rows = sourceInventory.map((row) => {
            const key = getAuthoritativeAssignmentLookupKeys(row).find((candidate) => assignmentByKey.has(candidate)) || '';
            const matched = !!key;
            if (matched) matchedCount += 1;
            const assignments = matched ? Array.from(assignmentByKey.get(key).values()) : [''];
            const assignedToUsers = assignments.map((value) => String(value || '').trim());
            const assignedTo = assignedToUsers.find(Boolean) || '';
            if (!assignedTo) {
                hasUnassigned = true;
                unassignedCount += 1;
            }
            return Object.assign({}, row, {
                ASSIGNEDTO: assignedTo,
                assignedto: assignedTo,
                ASSIGNEDTO_USERS: assignedToUsers,
                assignedto_users: assignedToUsers
            });
        });

        const assignedToOptions = Array.from(assignedNames.values()).sort(compareInquiryOptions);
        if (hasUnassigned) assignedToOptions.unshift(UNASSIGNED_INQUIRY_LABEL);
        return {
            rows,
            assignedToOptions,
            assignmentCount: assignmentByKey.size,
            matchedCount,
            unassignedCount
        };
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
        if (match) return toEpochDay(Number(match[1]), Number(match[2]), Number(match[3]));
        // Apps Script serializes Date cells with a weekday/month prefix. Read
        // only the calendar portion so timezone and DST text cannot shift it.
        match = raw.match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})(?:\s|$)/i);
        if (!match) return null;
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        return toEpochDay(Number(match[3]), monthNames.indexOf(String(match[1]).toLowerCase()) + 1, Number(match[2]));
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

    function isActiveHoldStopCode(value) {
        const code = String(value == null ? '' : value).trim().toUpperCase();
        return code === 'H' || code === 'S';
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
        const diagnostics = { invalidHoldStartDateCount: 0, invalidLocationNoteDateCount: 0 };
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
            const holdStopCode = getHoldStopCode(row);
            const holdStartValue = getHoldStart(row);
            const locationNoteDateValue = getLocationNoteDate(row);
            const holdStartDay = parseInventoryDateEpochDay(holdStartValue);
            const locationNoteDay = parseInventoryDateEpochDay(locationNoteDateValue);
            if (holdStartValue && holdStartDay == null) diagnostics.invalidHoldStartDateCount += 1;
            if (locationNoteDateValue && locationNoteDay == null) diagnostics.invalidLocationNoteDateCount += 1;
            const metadata = {
                itemCode,
                season,
                salesYear,
                priority,
                assignedTo: getAssignedTo(row),
                holdStopCode,
                location: textValue(row, ['LOCATIONCODE', 'locationcode']),
                oldHold: isActiveHoldStopCode(holdStopCode) && holdStartDay != null && todayEpochDay - holdStartDay > settings.holdAgeDays,
                oldLocationNote: locationNoteDay != null && todayEpochDay - locationNoteDay > settings.locationNoteAgeDays,
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
            if (season === 'U1') reports.u1.push(row);
            if (season === 'U2') reports.u2.push(row);
            if (season === 'U3') reports.u3.push(row);
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
            diagnostics,
            centralDateKey: `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
        };
    }

    function classifyScriptCompatibleRows(rows, options) {
        const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
        const config = options && typeof options === 'object' ? options : {};
        const settings = normalizeSettings(config.settings);
        const currentSeason = String(config.currentSeason || 'F1').trim().toUpperCase() || 'F1';
        const currentSalesYear = normalizeConfiguredSalesYear(config.currentSalesYear);
        const nextSeason = String(config.nextSeason || (currentSeason === 'F1' ? 'S1' : 'F1')).trim().toUpperCase();
        const nextSalesYear = normalizeConfiguredSalesYear(
            config.nextSalesYear == null ? (currentSeason === 'F1' ? currentSalesYear : currentSalesYear + 1) : config.nextSalesYear
        );
        const todayParts = getCentralDateParts(config.now);
        const todayEpochDay = toEpochDay(todayParts.year, todayParts.month, todayParts.day);
        const aggregates = new Map();
        const rowMetadata = new Map();
        const diagnostics = { invalidHoldStartDateCount: 0, invalidLocationNoteDateCount: 0 };

        sourceRows.forEach((row, sourceIndex) => {
            const itemCode = normalizeItemCode(row);
            if (!itemCode) return;
            const season = normalizeSeason(row);
            const salesYear = getRowSalesYear(row);
            const validSalesYear = salesYear != null && salesYear > 0 && salesYear <= currentSalesYear;
            const holdStopCode = getHoldStopCode(row);
            const holdStartValue = getHoldStart(row);
            const locationNoteDateValue = getLocationNoteDate(row);
            const holdStartDay = parseInventoryDateEpochDay(holdStartValue);
            const locationNoteDay = parseInventoryDateEpochDay(locationNoteDateValue);
            if (holdStartValue && holdStartDay == null) diagnostics.invalidHoldStartDateCount += 1;
            if (locationNoteDateValue && locationNoteDay == null) diagnostics.invalidLocationNoteDateCount += 1;
            const metadata = {
                itemCode,
                season,
                salesYear,
                validSalesYear,
                priority: getPriority(row),
                assignedTo: getAssignedTo(row),
                holdStopCode,
                oldHold: isActiveHoldStopCode(holdStopCode) && holdStartDay != null && todayEpochDay - holdStartDay > settings.holdAgeDays,
                oldLocationNote: locationNoteDay != null && todayEpochDay - locationNoteDay > settings.locationNoteAgeDays,
                slts: getRowSLts(row),
                sourceIndex
            };
            rowMetadata.set(row, metadata);
            if (!aggregates.has(itemCode)) {
                aggregates.set(itemCode, {
                    hasPriority: false,
                    hasValidF1: false,
                    hasOldHold: false,
                    qualifiesLowStock: false
                });
            }
            const aggregate = aggregates.get(itemCode);
            if (metadata.priority) aggregate.hasPriority = true;
            if (season === 'F1' && validSalesYear) {
                aggregate.hasValidF1 = true;
                if (metadata.slts < settings.lowStockMaxSLts) aggregate.qualifiesLowStock = true;
            }
            if (metadata.oldHold) aggregate.hasOldHold = true;
        });

        const reports = REPORT_IDS.reduce((acc, reportId) => {
            acc[reportId] = [];
            return acc;
        }, {});
        const supportSeasons = new Set(['U1', 'U2', 'U3', 'X']);

        sourceRows.forEach((row) => {
            const metadata = rowMetadata.get(row);
            if (!metadata) return;
            const aggregate = aggregates.get(metadata.itemCode);
            if (!aggregate) return;
            const isNextTarget = metadata.season === nextSeason && metadata.salesYear === nextSalesYear;

            if (metadata.priority && metadata.season !== 'F1') reports['s1-with-pri'].push(row);
            if (metadata.season === 'U1') reports.u1.push(row);
            if (metadata.season === 'U2') reports.u2.push(row);
            if (metadata.season === 'U3') reports.u3.push(row);
            if (metadata.oldLocationNote) reports['od-loc-note-date'].push(row);
            if (metadata.oldHold) reports['hs-plus-5-days'].push(row);
            if (aggregate.hasOldHold && !metadata.holdStopCode) reports['get-off-hold'].push(row);
            if (aggregate.qualifiesLowStock
                && ((supportSeasons.has(metadata.season) && metadata.validSalesYear) || isNextTarget)) {
                reports['low-stock'].push(row);
            }
            if (!aggregate.hasPriority) reports['no-pri'].push(row);
            if (metadata.season === 'X') reports.culls.push(row);
            if (!aggregate.hasValidF1) reports['not-in-f1'].push(row);
        });

        const compareScriptRows = (left, right) => {
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
            result = (leftMeta.validSalesYear ? 1 : 2) - (rightMeta.validSalesYear ? 1 : 2);
            if (result) return result;
            result = Number(leftMeta.salesYear || 0) - Number(rightMeta.salesYear || 0);
            return result || leftMeta.sourceIndex - rightMeta.sourceIndex;
        };
        REPORT_IDS.forEach((reportId) => reports[reportId].sort(compareScriptRows));
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
            diagnostics,
            centralDateKey: `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
        };
    }

    function getInquiryFieldValue(row, key) {
        const safeKey = String(key || '').trim().toUpperCase();
        return firstValue(row, ITEM_INQUIRY_FIELD_ALIASES[safeKey] || [safeKey, safeKey.toLowerCase()], '');
    }

    function normalizeInquiryFilter(value) {
        return String(value == null ? '' : value).trim();
    }

    function compareInquiryOptions(left, right) {
        return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
    }

    function uniqueInquiryOptions(values, includeUnassigned) {
        const output = [];
        const seen = new Set();
        let hasUnassigned = false;
        values.forEach((value) => {
            const normalized = normalizeInquiryFilter(value);
            if (!normalized) {
                hasUnassigned = true;
                return;
            }
            const key = normalized.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            output.push(normalized);
        });
        output.sort(compareInquiryOptions);
        if (includeUnassigned && hasUnassigned) output.unshift(UNASSIGNED_INQUIRY_LABEL);
        return output;
    }

    function inquiryAssignedToMatches(row, selectedAssignedTo) {
        const selected = normalizeInquiryFilter(selectedAssignedTo);
        if (!selected) return true;
        const assignedTo = getAssignedTo(row);
        if (selected === UNASSIGNED_INQUIRY_LABEL) return !assignedTo;
        return assignedTo === selected;
    }

    function inquiryValueMatches(row, key, selectedValue) {
        const selected = normalizeInquiryFilter(selectedValue);
        return !selected || normalizeInquiryFilter(getInquiryFieldValue(row, key)) === selected;
    }

    function projectInquiryFields(row, fields) {
        return fields.reduce((record, field) => {
            record[field] = getInquiryFieldValue(row, field);
            return record;
        }, {});
    }

    function uniqueProjectedInquiryRows(rows, fields) {
        const output = [];
        const seen = new Set();
        rows.forEach((row) => {
            const projected = projectInquiryFields(row, fields);
            const key = fields.map((field) => String(projected[field] == null ? '' : projected[field])).join('\u001f');
            if (seen.has(key)) return;
            seen.add(key);
            output.push(projected);
        });
        return output;
    }

    function buildItemInquiryModel(reportRows, filters) {
        const rows = Array.isArray(reportRows) ? reportRows.filter(Boolean) : [];
        const sourceFilters = filters && typeof filters === 'object' ? filters : {};
        const selectedAssignedTo = normalizeInquiryFilter(firstValue(sourceFilters, ['assignedTo', 'assignedto'], ''));
        const selectedLocationCode = normalizeInquiryFilter(firstValue(sourceFilters, ['locationCode', 'locationcode'], ''));
        const selectedCommonName = normalizeInquiryFilter(firstValue(sourceFilters, ['commonName', 'commonname'], ''));
        const selectedContSize = normalizeInquiryFilter(firstValue(sourceFilters, ['contSize', 'contsize'], ''));
        const assignedScopedRows = rows.filter((row) => inquiryAssignedToMatches(row, selectedAssignedTo));
        const locationScopedRows = assignedScopedRows.filter((row) => inquiryValueMatches(row, 'LOCATIONCODE', selectedLocationCode));
        const commonScopedRows = locationScopedRows.filter((row) => inquiryValueMatches(row, 'COMMONNAME', selectedCommonName));
        const matchedRows = commonScopedRows.filter((row) => inquiryValueMatches(row, 'CONTSIZE', selectedContSize));
        return {
            filters: {
                assignedTo: selectedAssignedTo,
                locationCode: selectedLocationCode,
                commonName: selectedCommonName,
                contSize: selectedContSize
            },
            options: {
                assignedTo: uniqueInquiryOptions(rows.map(getAssignedTo), true),
                locationCodes: uniqueInquiryOptions(assignedScopedRows.map((row) => getInquiryFieldValue(row, 'LOCATIONCODE')), false),
                commonNames: uniqueInquiryOptions(locationScopedRows.map((row) => getInquiryFieldValue(row, 'COMMONNAME')), false),
                contSizes: uniqueInquiryOptions(commonScopedRows.map((row) => getInquiryFieldValue(row, 'CONTSIZE')), false)
            },
            matchedRows,
            sections: {
                item: uniqueProjectedInquiryRows(matchedRows, ITEM_INQUIRY_FIELD_GROUPS.item),
                season: uniqueProjectedInquiryRows(matchedRows, ITEM_INQUIRY_FIELD_GROUPS.season),
                location: matchedRows.map((row) => projectInquiryFields(row, ITEM_INQUIRY_FIELD_GROUPS.location))
            }
        };
    }

    root.GncEvalReports = Object.freeze({
        REPORT_IDS,
        REPORT_META,
        DEFAULT_SETTINGS,
        SEASON_ORDER,
        ITEM_INQUIRY_FIELD_GROUPS,
        UNASSIGNED_INQUIRY_LABEL,
        normalizeSalesYear,
        normalizeSettings,
        parseInventoryDateEpochDay,
        getCentralDateParts,
        compareRows,
        classifyRows,
        classifyScriptCompatibleRows,
        buildAuthoritativeAssignmentKey,
        buildAuthoritativeAssignmentExactKey,
        buildAuthoritativeAssignmentModel,
        buildItemInquiryModel
    });
})(typeof window !== 'undefined' ? window : globalThis);
