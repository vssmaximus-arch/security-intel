name: Update Security Intel
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      - run: pip install -r requirements.txt
      
      # We pass the secret key to the script here
      - name: Run AI News Agent
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: python scripts/news_agent.py

      - run: |
          git config --global user.name 'SecurityIntelBot'
          git config --global user.email 'bot@noreply.github.com'
          git pull --rebase
          git add public/data/news.json
          git commit -m "Update security-intel data" || exit 0
          git push
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
