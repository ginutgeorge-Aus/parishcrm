// Safety cap on the member rows fetched + decrypted by the birthday and member
// anniversary widgets. These queries scan all people with a DOB /
// membership date and decrypt each row's encrypted fields, so the cost grows
// unbounded with membership; the cap bounds it. Sized well above a single
// parish (500 could silently drop real birthdays). Callers fetch
// `PERSON_FETCH_CAP + 1` with `orderBy: { id: "asc" }` so the truncated set is
// deterministic and a hit cap shows <FetchCapNotice>. The proper fix is a
// DB-level month filter (DOB is encrypted, so needs a schema change).
export const PERSON_FETCH_CAP = 5000

// Defensive cap on the active-member roster loaded into the person-picker
// comboboxes (DGR receipts, petty-cash receipts, custodian/settings, import).
// These pickers ship the whole roster to the client and filter it in-browser
// (cmdk), so per-row cost is low but the payload grows unbounded with membership
// (split from). The cap bounds that payload. Set well above the
// current roster (hundreds) so no member becomes unselectable at today's scale;
// pair every capped query with a name `orderBy` so the truncated set is
// deterministic. If membership ever approaches this, move the pickers to a
// server-backed typeahead (`/api/people/search?q=`) instead of raising it.
export const PERSON_PICKER_CAP = 2000
