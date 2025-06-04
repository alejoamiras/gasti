FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile && \
    yarn global add ts-node typescript

# Copy source code
COPY . .

# Set Node options for memory optimization
ENV NODE_OPTIONS="--max-old-space-size=384"

# Start the bot
CMD ["yarn", "start"] 