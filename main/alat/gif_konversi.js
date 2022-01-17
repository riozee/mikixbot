const cp = require('child_process');
const fs = require('fs/promises');

exports.keMp4 = async (file) => {
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.mp4`;
    return await new Promise((resolve, reject) => {
        cp.exec(
            `ffmpeg -i ${file} -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2" -b:v 0 -crf 25 -f mp4 -vcodec libx264 -pix_fmt yuv420p ${keluaran}`,
            (eror) => {
                if (eror) return reject(eror);
                resolve(keluaran);
            }
        );
    });
};
