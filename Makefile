install_node:
	# 1. 更新系统包索引
	sudo apt update

	# 2. 安装必要工具，比如 curl, build-essential 等
	sudo apt install -y curl build-essential

	# 3. 安装 NVM
	curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
	# 注意：这里的版本号 v0.40.0 可以替换为最新的 release

	# 4. 让 shell 加载 nvm（在当前 shell 会话和以后开新的终端都用到）
	# 如果你用 bash：
	source ~/.bashrc
	# 如果你用 zsh：
	source ~/.zshrc
	# 或者 ~/.profile 看你的 shell 配置文件

	# 5. 验证 nvm 是否安装成功
	nvm --version

	# 6. 用 nvm 安装 Node 的 LTS 版本
	nvm install --lts

	# 7. 设置默认使用这个版本
	nvm alias default lts/*

	# 8. 验证 Node 和 npm 版本
	node -v
	npm -v

install_pnpm:
	# 安装pnpm
	curl -fsSL https://get.pnpm.io/install.sh | sh -

install:
	pnpm install

start:
	pnpm dev


uv:
	uv sync

venv:
	python3.12 -m venv .venv

deps:
	pip3 install -r examples/voice_agents/requirements.txt
# 	pip3 install "livekit-agents[openai,silero,deepgram,cartesia,turn-detector]~=1.0"

install_server:
	# https://docs.livekit.io/home/self-hosting/local/
	curl -sSL https://get.livekit.io | bash
	sudo chmod 755 /usr/local/bin

start_server:
	livekit-server --dev --bind 0.0.0.0

