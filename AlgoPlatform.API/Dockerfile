# ===== build stage =====
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# копируем весь репозиторий (быстро работает только с .dockerignore)
COPY . .

# восстанавливаем и публикуем ТОЛЬКО веб-проект
RUN dotnet restore ./AlgoPlatform.API/AlgoPlatform.API.csproj
RUN dotnet publish ./AlgoPlatform.API/AlgoPlatform.API.csproj -c Release -o /app /p:UseAppHost=false

# ===== runtime stage =====
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .

# слушаем на 0.0.0.0, чтобы порт пробрасывался наружу
ENV ASPNETCORE_URLS=http://0.0.0.0:5280
EXPOSE 5280

ENTRYPOINT ["dotnet", "AlgoPlatform.API.dll"]