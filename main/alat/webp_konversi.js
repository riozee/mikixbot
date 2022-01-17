const cp = require('child_process');
const fs = require('fs/promises');

exports.keWebp = async (file, eks) => {
    const fileYangDidukung = ['jpg', 'png', 'gif', 'mp4', 'webp', 'mpeg', 'avi', 'ogv', 'webm', '3gp'];
    if (!fileYangDidukung.includes(eks)) throw `Format file tidak didukung: ${eks}`;
    return new Promise((resolve, reject) => {
        const filename = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.webp`;
        cp.exec(
            `ffmpeg -i ${file} -vcodec libwebp -compression_level 6 -q:v 25 -b:v 200k -vf "scale='if(gt(a,1),520,-1)':'if(gt(a,1),-1,520)':flags=lanczos:force_original_aspect_ratio=decrease,format=bgra,pad=520:520:-1:-1:color=#00000000,setsar=1" ${filename}`,
            (eror) => {
                if (eror) return reject(eror);
                resolve(filename);
            }
        );
    });
};

exports.setExif = async (file, pack, author) => {
    const json = {
        'sticker-pack-id': 'com.etheral.waifuhub.android.stickercontentprovider b5e7275f-f1de-4137-961f-57becfad34f2',
        'sticker-pack-name': pack || '',
        'sticker-pack-publisher': author || '',
    };
    let length = new TextEncoder('utf-8').encode(JSON.stringify(json)).length;
    const f = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]);
    const code = [0x00, 0x00, 0x16, 0x00, 0x00, 0x00];
    if (length > 256) {
        length = length - 256;
        code.unshift(0x01);
    } else {
        code.unshift(0x00);
    }
    const fff = Buffer.from(code);
    const ffff = Buffer.from(JSON.stringify(json), 'utf-8');
    let len;
    if (length < 16) {
        len = length.toString(16);
        len = '0' + length;
    } else {
        len = length.toString(16);
    }
    const ff = Buffer.from(len, 'hex');
    const buffer = Buffer.concat([f, ff, fff, ffff]);
    const exifFile = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.exif`;
    await fs.writeFile(exifFile, buffer);
    return await new Promise((resolve, reject) => {
        cp.exec(`webpmux -set exif ${exifFile} ${file} -o ${file}`, (eror) => {
            if (eror) return reject(eror);
            resolve(file);
        });
    });
};

exports.kePng = async (file) => {
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.png`;
    return await new Promise((resolve, reject) => {
        cp.exec(`ffmpeg -i ${file} ${keluaran}`, (eror) => {
            if (eror) return reject(eror);
            resolve(keluaran);
        });
    });
};

exports.keGif = async (file) => {
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.gif`;
    return await new Promise((resolve, reject) => {
        cp.exec(`convert ${file} ${keluaran}`, (eror) => {
            if (eror) return reject(eror);
            resolve(keluaran);
        });
    });
};
