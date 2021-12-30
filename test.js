const minimist = require('minimist');
// for (const [key, value] of Object.entries(
//     minimist(process.argv.slice(2), { boolean: true })
// )) {
//     process.env['MIKI_' + key.toUpperCase()] = value;
// }
// console.log(process.env);
console.log(minimist(process.argv.slice(2)));
