INSTALL = install
INSTALL_DATA = $(INSTALL) -D -m 644 $^ $@
SRCDIR = $(dir $(lastword $(MAKEFILE_LIST)))

$(DESTDIR)MD5.js: $(DESTDIR)%: $(SRCDIR)%
	$(INSTALL_DATA)
