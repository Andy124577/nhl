You'll need QT to build FHM:

ftp://ftp.qt.nokia.com/qt/source/qt-win-opensource-4.7.4-vs2008.exe

Optionally, you could install the Visual Studio Add-In:

http://releases.qt-project.org/vsaddin/qt-vs-addin-1.1.11-opensource.exe

How to create the FHM Mac project
http://qt-project.org/doc/qt-4.8/qmake-project-files.html

- cd into /fhm/fhm where the file fhb.pro is and edit the file as needed
- to create fhm.pro, run this command: qmake -spec macx-xcode fhm.pro
- open the project file in Xcode and edit settings as required

After building the app file, add the frameworks with this command:
macdeployqt "Franchise Hockey Manager 2014.app"

If you have to add code files (cpp/h) you should do that manually in the script files which are inside the Xcode project file bundle.