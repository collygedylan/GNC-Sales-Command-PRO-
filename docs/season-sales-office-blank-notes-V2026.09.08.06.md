# Season Sales Office requires an AV Note — V2026.09.08.06

The Season Sales Notes Sales Office tab shows only rows with a displayed, saved AV Note. Null, empty, and whitespace-only notes are excluded from the list and its count/export, including cached rows cleared by a later update. Explicit blank saved notes remain authoritative over imported CAV text.

The filter applies to tab visibility. Existing tracking records support the protected note-edit and completion paths, so a newly saved note can make a row visible again. Photo/spec reset rules and CAV import protection remain in effect.

At implementation, 118 of the 178 open tracked rows had blank AV Notes; 60 had saved notes. No database rows or history were deleted.
