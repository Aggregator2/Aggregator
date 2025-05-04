@echo off
echo =========================================
echo Restarting PostgreSQL service...
echo =========================================
net stop postgresql-x64-15
net start postgresql-x64-15
timeout /t 5

echo =========================================
echo Checking if PostgreSQL is listening on port 5432...
echo =========================================
netstat -ano | findstr :5432

echo =========================================
echo If you see LISTENING above, PostgreSQL is working!
echo Otherwise, something is still wrong.
echo =========================================

pause
