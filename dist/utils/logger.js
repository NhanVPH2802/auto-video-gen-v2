const ts = () => new Date().toISOString().replace("T", " ").substring(0, 19);
export const log = {
    step: (n, total, msg) => console.log(`[${ts()}] [${n}/${total}] ${msg}`),
    info: (msg) => console.log(`[${ts()}] ${msg}`),
    warn: (msg) => console.warn(`[${ts()}] WARN ${msg}`),
    error: (msg, err) => {
        console.error(`[${ts()}] ERROR ${msg}`);
        if (err instanceof Error)
            console.error(err.stack);
        else if (err)
            console.error(err);
    },
};
