INSTALL = install
INSTALL_DATA = $(INSTALL) -D -m 644 $^ $@
SRCDIR = $(dir $(lastword $(MAKEFILE_LIST)))

all: $(addprefix $(DESTDIR),MD5.js MD5.worker.js)

$(DESTDIR)MD5.js: $(DESTDIR)%: $(SRCDIR)%
	$(INSTALL_DATA)

$(DESTDIR)MD5.worker.js: $(SRCDIR)worker.js
	$(INSTALL_DATA)

include $(SRCDIR)wasm-module/makefile
