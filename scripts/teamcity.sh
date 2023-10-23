#!/usr/bin/env bash

set -e

echo node version at start is $(node --version)



export NVM_DIR="$HOME/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"  # This loads nvm

nvm install
nvm use


echo node version after nvm is $(node --version)

npm install
npm run lint
npm test
npm run teamcity:deploy
