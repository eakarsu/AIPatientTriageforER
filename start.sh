#!/bin/bash

# ========================================
# AI Patient Triage for ER - Start Script
# ========================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════╗"
echo "║     AI Patient Triage for ER              ║"
echo "║     Intelligent Emergency Care System     ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

BACKEND_PORT=${BACKEND_PORT:-3001}
FRONTEND_PORT=${FRONTEND_PORT:-3000}

# Kill processes on used ports
echo -e "${YELLOW}Cleaning up ports ${BACKEND_PORT} and ${FRONTEND_PORT}...${NC}"
lsof -ti:${BACKEND_PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:${FRONTEND_PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Check PostgreSQL
echo -e "${YELLOW}Checking PostgreSQL...${NC}"
if ! command -v psql &> /dev/null; then
  echo -e "${RED}PostgreSQL not found. Please install it first.${NC}"
  exit 1
fi

# Check if PostgreSQL is running
if ! pg_isready -q 2>/dev/null; then
  echo -e "${YELLOW}Starting PostgreSQL...${NC}"
  brew services start postgresql@14 2>/dev/null || brew services start postgresql 2>/dev/null || true
  sleep 3
fi

# Create database if not exists
echo -e "${YELLOW}Setting up database...${NC}"
DB_NAME=${DB_NAME:-er_triage}
psql postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" 2>/dev/null | grep -q 1 || \
  createdb ${DB_NAME} 2>/dev/null || true
echo -e "${GREEN}Database ready${NC}"

# Install backend dependencies
echo -e "${YELLOW}Installing backend dependencies...${NC}"
cd backend
npm install --silent 2>&1 | tail -1
echo -e "${GREEN}Backend dependencies installed${NC}"

# Seed database
echo -e "${YELLOW}Seeding database with sample data...${NC}"
node seeds/seed.js
cd ..

# Install frontend dependencies
echo -e "${YELLOW}Installing frontend dependencies...${NC}"
cd frontend
npm install --silent 2>&1 | tail -1
echo -e "${GREEN}Frontend dependencies installed${NC}"
cd ..

# Start backend with hot reload
echo -e "${CYAN}Starting backend on port ${BACKEND_PORT} with hot reload...${NC}"
cd backend
npx nodemon server.js &
BACKEND_PID=$!
cd ..
sleep 3

# Start frontend with hot reload
echo -e "${CYAN}Starting frontend on port ${FRONTEND_PORT} with hot reload...${NC}"
cd frontend
PORT=${FRONTEND_PORT} BROWSER=none npm start &
FRONTEND_PID=$!
cd ..

# Cleanup on exit
cleanup() {
  echo -e "\n${YELLOW}Shutting down...${NC}"
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  lsof -ti:${BACKEND_PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti:${FRONTEND_PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
  echo -e "${GREEN}Shutdown complete${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "\n${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Application is starting!                 ║${NC}"
echo -e "${GREEN}║                                           ║${NC}"
echo -e "${GREEN}║  Frontend: http://localhost:${FRONTEND_PORT}          ║${NC}"
echo -e "${GREEN}║  Backend:  http://localhost:${BACKEND_PORT}/api     ║${NC}"
echo -e "${GREEN}║                                           ║${NC}"
echo -e "${GREEN}║  Login Credentials:                       ║${NC}"
echo -e "${GREEN}║  Admin:     admin@ertriage.com             ║${NC}"
echo -e "${GREEN}║  Doctor:    doctor@ertriage.com            ║${NC}"
echo -e "${GREEN}║  Nurse:     nurse@ertriage.com             ║${NC}"
echo -e "${GREEN}║  Reception: reception@ertriage.com         ║${NC}"
echo -e "${GREEN}║  Password:  password123                    ║${NC}"
echo -e "${GREEN}║                                           ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"

# Wait for both processes
wait
