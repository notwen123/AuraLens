How to use
1
Install fourmeme CLI

Run in terminal: pnpm add -g @four-meme/four-meme-ai@latest. Then use fourmeme command.
2
Install the four-meme-ai skill

Run in terminal: npx skills add four-meme-community/four-meme-ai to install this skill into your agent environment.
3
Configure private key and RPC

In the project directory where you run commands, add a .env with PRIVATE_KEY=... and optional BSC_RPC_URL=.... The CLI loads it from the current directory. If you use OpenClaw, you can also set the four-meme-ai apiKey to your PRIVATE_KEY in the Skill management page.![alt text](image.png)