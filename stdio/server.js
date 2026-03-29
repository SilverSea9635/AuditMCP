import { addNumbers, createFileInDirectory } from './Utils.js';
import { audit } from './audit_server.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from 'zod/v4';

const server = new McpServer({
  name: 'minimal-stdio-mcp',
  version: '0.0.1',
  title: '最小化stdio MCPCP 服务器',
});

const transport = new StdioServerTransport();

server.registerTool('add_numbers', {
  description: '计算两个数字的和',
  inputSchema: {
    a: z.number().describe('第一个数字'),
    b: z.number().describe('第二个数字'),
  },
}, async ({ a, b }) => {
  const sum = addNumbers(a, b);
  console.error(123)
  return {
    content: [
      {
        type: 'text',
        text: String(sum),
      },
    ],
  };
});

server.registerTool('create_file', {
  description: '在指定目录创建文件',
  inputSchema: {
    directoryPath: z.string().describe('目标目录'),
    fileName: z.string().describe('文件名'),
    content: z.string().default('').describe('文件内容，默认空字符串'),
  },
}, async ({ directoryPath, fileName, content }) => {
  const result = await createFileInDirectory(directoryPath, fileName, content);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

server.registerTool('audit', {
  description: '审计项目依赖的安全漏洞',
  inputSchema: {
    projectRoot: z.string().describe('项目根目录或 GitHub 仓库地址'),
    savePath: z.string().describe('审计结果保存路径'),
  },
}, async ({ projectRoot, savePath }) => {
  const resultPath = await audit(projectRoot, savePath);

  return {
    content: [
      {
        type: 'text',
        text: resultPath,
      },
    ],
  };
});

async function main() {
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
