"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = startServe;
exports.closeServe = closeServe;
// import "./logger";
require("./err");
require("./env");
const express_1 = __importDefault(require("express"));
const socket_io_1 = require("socket.io");
const node_http_1 = __importDefault(require("node:http"));
const express_ws_1 = __importDefault(require("express-ws"));
const morgan_1 = __importDefault(require("morgan"));
const cors_1 = __importDefault(require("cors"));
const core_1 = __importDefault(require("@/core"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const utils_1 = __importDefault(require("@/utils"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const index_1 = __importDefault(require("@/socket/index"));
const getPath_1 = require("@/utils/getPath");
const app = (0, express_1.default)();
const server = node_http_1.default.createServer(app);
async function checkPermissions() {
    if (!(0, getPath_1.isEletron)())
        return true;
    const userDataPath = utils_1.default.getPath();
    try {
        fs_1.default.mkdirSync(userDataPath, { recursive: true });
        const testFile = path_1.default.join(userDataPath, ".access_test");
        fs_1.default.writeFileSync(testFile, "test");
        fs_1.default.unlinkSync(testFile);
    }
    catch (e) {
        const { dialog, app } = require("electron");
        const { response } = await dialog.showMessageBox({
            type: "warning",
            title: "权限不足",
            message: "应用无法访问数据目录",
            detail: `无法读写以下目录：\n${userDataPath}\n\n请联系管理员授予权限，或以管理员身份运行本程序。`,
            buttons: ["确认退出"],
            defaultId: 0,
        });
        if (response === 0) {
            app.quit();
        }
    }
}
async function startServe(randomPort = false) {
    await checkPermissions();
    await utils_1.default.writeVersion();
    const io = new socket_io_1.Server(server, { cors: { origin: "*" } });
    (0, index_1.default)(io);
    if (process.env.NODE_ENV == "dev")
        await (0, core_1.default)();
    (0, express_ws_1.default)(app);
    app.use((0, morgan_1.default)("dev"));
    app.use((0, cors_1.default)({ origin: "*" }));
    app.use(express_1.default.json({ limit: "100mb" }));
    app.use(express_1.default.urlencoded({ extended: true, limit: "100mb" }));
    // oss 静态资源
    const ossDir = utils_1.default.getPath("oss");
    if (!fs_1.default.existsSync(ossDir)) {
        fs_1.default.mkdirSync(ossDir, { recursive: true });
    }
    console.log("文件目录:", ossDir);
    app.use("/oss", express_1.default.static(ossDir, { acceptRanges: false }));
    // skills 静态资源
    const skillsDir = utils_1.default.getPath("skills");
    if (!fs_1.default.existsSync(skillsDir)) {
        fs_1.default.mkdirSync(skillsDir, { recursive: true });
    }
    console.log("文件目录:", skillsDir);
    // 只允许图片文件访问
    app.use("/skills", (req, res, next) => {
        /\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(req.path) ? next() : res.status(403).end();
    }, express_1.default.static(skillsDir, { acceptRanges: false }));
    // assets 静态资源
    const assetsDir = utils_1.default.getPath("assets");
    if (!fs_1.default.existsSync(assetsDir)) {
        fs_1.default.mkdirSync(assetsDir, { recursive: true });
    }
    console.log("文件目录:", assetsDir);
    app.use("/assets", express_1.default.static(assetsDir, { acceptRanges: false }));
    // data/web 静态网站
    const webDir = utils_1.default.getPath("web");
    if (fs_1.default.existsSync(webDir)) {
        console.log("静态网站目录:", webDir);
        app.use(express_1.default.static(webDir, { acceptRanges: false }));
    }
    else {
        console.warn("静态网站目录不存在:", webDir);
    }
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "kais-core-backend", version: "6.0.0" });
    });
    app.use(async (req, res, next) => {
        const setting = await utils_1.default.db("o_setting").where("key", "tokenKey").select("value").first();
        if (!setting)
            return res.status(444).send({ message: "服务器秘钥未配置，请联系管理员" });
        const { value: tokenKey } = setting;
        // 从 header 或 query 参数获取 token
        const rawToken = req.headers.authorization || req.query.token || "";
        const token = rawToken.replace("Bearer ", "");
        // 白名单路径
        if (req.path === "/api/login/login")
            return next();
        if (!token)
            return res.status(401).send({ message: "未提供token" });
        try {
            const decoded = jsonwebtoken_1.default.verify(token, tokenKey);
            req.user = decoded;
            next();
        }
        catch (err) {
            return res.status(401).send({ message: "无效的token" });
        }
    });
    const router = await Promise.resolve().then(() => __importStar(require("@/router")));
    await router.default(app);
    // 404 处理
    app.use((_, res, next) => {
        return res.status(404).send({ message: "API 404 Not Found" });
    });
    // 错误处理
    app.use((err, _, res, __) => {
        res.locals.message = err.message;
        res.locals.error = err;
        console.error(err);
        res.status(err.status || 500).send(err);
    });
    const port = randomPort ? 0 : (parseInt(process.env.PORT || '') || 10588);
    return await new Promise((resolve) => {
        server.listen(port, async () => {
            const address = server.address();
            const realPort = typeof address === "string" ? address : address?.port;
            console.log(`[服务启动成功]: http://localhost:${realPort}`);
            resolve(realPort);
        });
    });
}
// 支持await关闭
function closeServe() {
    return new Promise((resolve, reject) => {
        if (server) {
            server.close((err) => {
                if (err)
                    return reject(err);
                console.log("[服务已关闭]");
                resolve();
            });
        }
        else {
            resolve();
        }
    });
}
const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron)
    startServe();
