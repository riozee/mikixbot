const fs = require('fs/promises');

setInterval(async () => {
    const files = await fs.readdir('./tmp/');
    for (const file of files) {
        const date = Number(file.split('#')[0]);
        if (Date.now() - date > 60000 * 5) {
            await fs.unlink('./tmp/' + file);
        }
    }
}, 60000);
