const base = import.meta.env.BASE_URL.replace(/\/$/, '')
/** Base-aware internal URL: url('docs/installation/') → '/parishcrm/docs/installation/'. */
export const url = (path = '') => `${base}/${path.replace(/^\//, '')}`
