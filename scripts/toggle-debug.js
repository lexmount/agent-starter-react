#!/usr/bin/env node

/**
 * 音频过滤调试模式切换脚本
 * 使用方法:
 *   node scripts/toggle-debug.js on   # 开启调试模式
 *   node scripts/toggle-debug.js off  # 关闭调试模式
 *   node scripts/toggle-debug.js     # 查看当前状态
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../app-config.ts');
const envPath = path.join(__dirname, '../.env.local');

function getCurrentStatus() {
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const match = configContent.match(/showAudioFilterDebug:\s*(.*?),/);
    if (match) {
      const value = match[1].trim();
      if (value.includes('true')) {
        return 'ON';
      } else if (value.includes('false')) {
        return 'OFF';
      }
    }
    return 'UNKNOWN';
  } catch (error) {
    console.error('无法读取配置文件:', error.message);
    return 'ERROR';
  }
}

function updateConfig(enable) {
  try {
    let configContent = fs.readFileSync(configPath, 'utf8');

    const newValue = enable
      ? "process.env.NEXT_PUBLIC_SHOW_AUDIO_DEBUG === 'true' || true"
      : "process.env.NEXT_PUBLIC_SHOW_AUDIO_DEBUG === 'true' || false";

    configContent = configContent.replace(
      /showAudioFilterDebug:\s*.*?,/,
      `showAudioFilterDebug: ${newValue}, // 是否显示音频过滤调试组件`
    );

    fs.writeFileSync(configPath, configContent);
    console.log(`✅ 配置文件已更新: 调试模式 ${enable ? '开启' : '关闭'}`);

    // 同时更新环境变量文件
    updateEnvFile(enable);
  } catch (error) {
    console.error('❌ 更新配置文件失败:', error.message);
  }
}

function updateEnvFile(enable) {
  try {
    let envContent = '';

    // 读取现有的 .env.local 文件
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const envVar = `NEXT_PUBLIC_SHOW_AUDIO_DEBUG=${enable}`;

    if (envContent.includes('NEXT_PUBLIC_SHOW_AUDIO_DEBUG=')) {
      // 更新现有的环境变量
      envContent = envContent.replace(/NEXT_PUBLIC_SHOW_AUDIO_DEBUG=.*/, envVar);
    } else {
      // 添加新的环境变量
      envContent += envContent.endsWith('\n') ? '' : '\n';
      envContent += `# Audio Filter Debug\n${envVar}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ 环境变量已更新: ${envVar}`);
  } catch (error) {
    console.error('❌ 更新环境变量失败:', error.message);
  }
}

function showUsage() {
  console.log(`
🎛️  音频过滤调试模式控制器

📊 当前状态: ${getCurrentStatus()}

🔧 使用方法:
  node scripts/toggle-debug.js on   # 开启调试模式
  node scripts/toggle-debug.js off  # 关闭调试模式
  node scripts/toggle-debug.js      # 查看当前状态

📝 说明:
  - 开启后会在页面右上角显示音频轨道调试面板
  - 关闭后调试面板将隐藏
  - 修改后需要重启开发服务器生效

🚀 快速重启:
  npm run dev
  # 或
  yarn dev
  # 或
  pnpm dev
`);
}

// 主逻辑
const command = process.argv[2];

switch (command) {
  case 'on':
  case 'enable':
  case 'true':
    updateConfig(true);
    console.log('\n🚀 请重启开发服务器以应用更改');
    break;

  case 'off':
  case 'disable':
  case 'false':
    updateConfig(false);
    console.log('\n🚀 请重启开发服务器以应用更改');
    break;

  default:
    showUsage();
    break;
}
