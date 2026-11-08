async function fetchActiveRequestLiveRows(selectFields = '*', options = {}) {
            // Legacy request/footer reads share the same document lifetime as
            // verified reads. Reload cancellation is not a missing-view error.
            const signal = options.signal || productionLiveSyncNavigation.signal;
            const requireActiveDocument = () => {
                if (signal.aborted) throw Object.assign(new Error('Request queue read cancelled.'), { code: 'REQUEST_ABORTED' });
            };
            requireActiveDocument();
            const query = buildActiveRequestLiveRowsQuery(selectFields);
            const requestOwner = getSupabaseReadIdentityScope();
            const requestSequence = (fetchActiveRequestLiveRows.sequence || 0) + 1;
            fetchActiveRequestLiveRows.sequence = requestSequence;
            const readOptions = { ...(options && typeof options === 'object' ? options : {}), force_fresh:true, cache:'no-store', signal };
            try {
                const rows = await fetchAllSupabaseRows(ACTIVE_REQUEST_TABLE, query, readOptions);
                requireActiveDocument();
                if (requestOwner !== getSupabaseReadIdentityScope()) throw Object.assign(new Error('Request owner changed.'), {code:'REQUEST_ABORTED'});
                Object.defineProperty(rows, 'requestReadMeta', {value:{owner:requestOwner,sequence:requestSequence,authoritative:selectFields === '*'},configurable:true});
                return rows;
            } catch (error) {
                requireActiveDocument();
                if (error && error.code === 'REQUEST_ABORTED') throw error;
                if (requestOwner !== getSupabaseReadIdentityScope()) throw Object.assign(new Error('Request owner changed.'), {code:'REQUEST_ABORTED'});
                window.GncRuntimeWatchdog?.capture?.(error, 'fetchActiveRequestLiveRows:canonicalPending');
                return (Array.isArray(requestsInventory) ? requestsInventory : []).filter((row) => row && !row.REQUEST_HISTORY);
            }
        }

