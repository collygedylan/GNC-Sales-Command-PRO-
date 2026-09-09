# Home visibility on phones and touch devices — V2026.09.09.01

REP, Sales Rep, Sales, and CSR Home tiles are rendered into the dynamic Home section. A mobile/touch CSS rule hid that section unconditionally, leaving users with no visible module buttons despite valid permissions. The same rule also hid Request access loading and retry messages.

The rule now hides only an empty dynamic section. Populated role-specific Home content remains visible and scrollable. Other roles continue to use their authorized static dashboard. Request creation permissions and module access decisions are unchanged.

The built-shell browser suite checks both Home layouts across the supported role families on Android, iPhone, tablet, and desktop. It verifies actual visibility, navigation, denied modules, and Request access loading/error states. These checks run before publishing and against the deployed shell using isolated fixtures that block service mutations.
