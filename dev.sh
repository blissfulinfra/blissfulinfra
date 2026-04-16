./rebuild.sh

node packages/cli/dist/index.js start dev-app --plugins localstack:localstack
node packages/cli/dist/index.js dev --templates dev-app

