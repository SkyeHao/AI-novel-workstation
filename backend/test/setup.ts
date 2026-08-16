/** 在导入任何模块前，将 API 状态文件指向临时位置，避免测试污染仓库 data/。 */
import * as os from "node:os";
import * as path from "node:path";

process.env.AI_NOVEL_STATE_FILE = path.join(os.tmpdir(), `anw-state-${process.pid}.json`);
process.env.AI_NOVEL_DATA_DIR = path.join(os.tmpdir(), `anw-data-${process.pid}`);
