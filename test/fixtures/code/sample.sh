$ ./get-darnly.sh --prefix=$HOME/.local -y
# install, then run
export PATH="$HOME/bin:$PATH"
darnly fix src/clock.ts | tee out.log && echo 'done' 2>&1
for f in *.ts; do wc -l "$f"; done
