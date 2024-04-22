import log from "@/next/log";
import { withTimeout } from "@ente/shared/utils";
import QueueProcessor from "@ente/shared/utils/queueProcessor";
import { expose } from "comlink";
import {
    ffmpegPathPlaceholder,
    inputPathPlaceholder,
    outputPathPlaceholder,
} from "constants/ffmpeg";
import { FFmpeg, createFFmpeg } from "ffmpeg-wasm";

export class DedicatedFFmpegWorker {
    private ffmpeg: FFmpeg;
    private ffmpegTaskQueue = new QueueProcessor<Uint8Array>();

    constructor() {
        this.ffmpeg = createFFmpeg({
            corePath: "/js/ffmpeg/ffmpeg-core.js",
            mt: false,
        });
    }

    /**
     * Execute a FFmpeg {@link command} on {@link blob}.
     *
     * This is a sibling of {@link ffmpegExec} exposed by the desktop app in
     * `ipc.ts`. See [Note: FFmpeg in Electron].
     */
    async exec(command: string[], blob: Blob, timeoutMs): Promise<Uint8Array> {
        if (!this.ffmpeg.isLoaded()) await this.ffmpeg.load();

        const go = () => ffmpegExec(this.ffmpeg, command, blob);

        const request = this.ffmpegTaskQueue.queueUpRequest(() =>
            timeoutMs ? withTimeout(go(), timeoutMs) : go(),
        );

        return await request.promise;
    }
}

expose(DedicatedFFmpegWorker, self);

const ffmpegExec = async (ffmpeg: FFmpeg, command: string[], blob: Blob) => {
    const inputPath = `${randomPrefix()}.in`;
    const outputPath = `${randomPrefix()}.out`;

    const cmd = substitutePlaceholders(command, inputPath, outputPath);

    const inputData = new Uint8Array(await blob.arrayBuffer());

    try {
        ffmpeg.FS("writeFile", inputPath, inputData);

        log.info(`Running FFmpeg (wasm) command ${cmd}`);
        await ffmpeg.run(...cmd);

        return ffmpeg.FS("readFile", outputPath);
    } finally {
        try {
            ffmpeg.FS("unlink", inputPath);
        } catch (e) {
            log.error(`Failed to remove input ${inputPath}`, e);
        }
        try {
            ffmpeg.FS("unlink", outputPath);
        } catch (e) {
            log.error(`Failed to remove output ${outputPath}`, e);
        }
    }
};

/** Generate a random string suitable for being used as a file name prefix */
const randomPrefix = () => {
    const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let result = "";
    for (let i = 0; i < 10; i++)
        result += alphabet[Math.floor(Math.random() * alphabet.length)];
    return result;
};

const substitutePlaceholders = (
    command: string[],
    inputFilePath: string,
    outputFilePath: string,
) =>
    command.map((segment) => {
        if (segment == ffmpegPathPlaceholder) {
            return "";
        } else if (segment == inputPathPlaceholder) {
            return inputFilePath;
        } else if (segment == outputPathPlaceholder) {
            return outputFilePath;
        } else {
            return segment;
        }
    });
