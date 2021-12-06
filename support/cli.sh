#!/bin/bash
set -e
# shellcheck disable=SC2164
SCRIPT_HOME="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
PROJECT_HOME="$( dirname "$SCRIPT_HOME" )"
PROJECT_CODE="$( dirname "$PROJECT_HOME" )"
PROJECT_VERSION="$(cat "$PROJECT_HOME/VERSION")"
REACT_APP_PROJECT_VERSION=$PROJECT_VERSION

function fn_exists() { [[ "$(type -t "$1")" = function ]]; }

function cmd.api.start {
  echo "Starting api"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/api" \
  && nvm use \
  && ./node_modules/.bin/nodemon --verbose \
    --signal SIGHUP \
    --watch .env \
    --watch src \
    --delay 1 \
    --exec "node src/server.js"
}

function cmd.app.start {
  echo "Starting app"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/app" \
  && nvm use \
  && ./node_modules/.bin/nodemon --verbose \
    --signal SIGHUP \
    --watch .env \
    --delay 1 \
    --exec "npm start"
}

function cmd.shell.start {
  echo "Starting native app gui"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/shell" \
  && nvm use \
  && npm start
}

function cmd.start {
  tmux kill-session -t "$PROJECT_CODE" || echo "No server running - starting new $PROJECT_CODE"
  tmux new-session -s "$PROJECT_CODE" \
      "$PROJECT_HOME/support/cli.sh api.start" \; \
      split-window "$PROJECT_HOME/support/cli.sh app.start" \; \
      select-layout tiled \; \
      set-option -w remain-on-exit on \; \
      set-option -w mouse on \; \
      set-option -g mouse on \; \
      bind-key -n C-c kill-session -t "$PROJECT_CODE"
}

function cmd.prepare {
  echo "Preparing infrastructure"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && echo "Preparing api" \
  && cd "$PROJECT_HOME/api" \
  && nvm use \
  && npm install \
  && echo "Preparing application" \
  && cd "$PROJECT_HOME/app" \
  && nvm use \
  && npm install \
  && echo "Preparing packages" \
  && cd "$PROJECT_HOME/packages/@podman-desktop-companion/container-client" \
  && nvm use \
  && npm install \
  && echo "Preparing shell" \
  && cd "$PROJECT_HOME/shell" \
  && nvm use \
  && npm install
}

function cmd.build {
  export NODE_ENV=production
  export REACT_APP_ENV="$NODE_ENV"
  export REACT_APP_PROJECT_VERSION="$REACT_APP_PROJECT_VERSION"
  echo "Building $PROJECT_VERSION app for linux desktop ($NODE_ENV, $REACT_APP_ENV, $REACT_APP_PROJECT_VERSION)"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/app" \
  && nvm use \
  && npm run react-scripts build
}

function cmd.bundle {
  export NODE_ENV=production
  export REACT_APP_ENV="$NODE_ENV"
  export REACT_APP_PROJECT_VERSION="$REACT_APP_PROJECT_VERSION"
  echo "Bundling $PROJECT_VERSION app for $TARGET desktop ($NODE_ENV, $REACT_APP_ENV, $REACT_APP_PROJECT_VERSION)"
  # Copy build assets
  rm -fr "$PROJECT_HOME/shell/build"
  cp -R "$PROJECT_HOME/app/build" "$PROJECT_HOME/shell/build"
  cp -R "$PROJECT_HOME/shell/public"/* "$PROJECT_HOME/shell/build"
  cp -R "$PROJECT_HOME/shell/icons/appIcon."* "$PROJECT_HOME/shell/build"
  # Ensure target dir
  mkdir -p "$PROJECT_HOME/shell/dist"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" \
  && cd "$PROJECT_HOME/shell" \
  && nvm use \
  && npm run "electron:package:$TARGET"
}

function cmd.help {
  echo ""
  echo "Welcome to CLI automation tool, the available commands are"
  echo ""
  # shellcheck disable=SC2005
  read -r -a COMMANDS <<< "$(echo "$(compgen -A function)" | tr "\n" " ")"
  for COMMAND_DECLARATION in "${COMMANDS[@]}"
  do
    if [[ "${COMMAND_DECLARATION:0:4}" == "cmd." ]]; then
      echo "-- ${COMMAND_DECLARATION:4}"
    fi
  done
  echo ""
}

# Entry point
function main {
  # Pre-check
  COMMAND="$1"
  if [[ -z $COMMAND ]] || [[ $COMMAND = "help" ]] || [[ $COMMAND = "--help" ]]; then
    cmd.help
    exit 0
  fi
  # Command
  CMD_NAME=cmd.$COMMAND
  if ! fn_exists "$CMD_NAME"; then
    echo "Command not found $CMD_NAME"
    exit 1
  fi
  trap "exit" INT TERM
  trap "kill 0" EXIT
  $CMD_NAME
}

main "$1" "${@:2}"