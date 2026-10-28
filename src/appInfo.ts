import pkg from '../package.json';

/** App version written into every export (from package.json, so there is one place to bump). */
export const APP_VERSION: string = pkg.version;
