$ ./get-darnly.sh --prefix=$HOME/.local -y
# install, then run
export PATH="$HOME/bin:$PATH"
darnly fix src/clock.ts | tee out.log && echo 'done' 2>&1
for f in *.ts; do wc -l "$f"; done
darnly fix src/clock.ts \
  --dry-run --out=out.diff
echo $HOME#x foo#bar "a"#b # a comment
for f \
  in a.ts b.ts; do wc -l "$f"; done
case "$1"
in fix) darnly fix;; esac
case "$1" in
  log) echo esac;;
esac
