export function syncInlineItemDetailShare(root) {
            if (!root) return;
            if (isCompactQueueDetail(activeItem, activeDetailSourceView || lastView)) {
                root.querySelector('[data-inline-detail-share]')?.remove();
                return;
            }
            if (root.querySelector('[data-inline-detail-share]')) return;
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.inlineDetailShare = 'true';
            button.className = 'rounded-xl bg-[#113221] text-white px-4 py-3 font-bold';
            button.textContent = '📋 Share / Copy';
            button.onclick = async () => {
                if (!activeItem) return;
                const request = isRequestOwnedPhotoRow(activeItem);
                await copyTextWithFallback(request ? formatRequestItemsText([activeItem]) : formatInventoryItemsText([activeItem]), request ? formatRequestItemsHtml([activeItem]) : formatInventoryItemsHtml([activeItem]));
                showToast('Copied', 'Card and all photos copied.');
            };
            root.prepend(button);
        }
