using CryptoDecisionAssistant.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CryptoDecisionAssistant.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<PriceAlert> PriceAlerts => Set<PriceAlert>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var alert = modelBuilder.Entity<PriceAlert>();
        alert.HasKey(x => x.Id);
        alert.Property(x => x.Symbol).HasMaxLength(16).IsRequired();
        alert.Property(x => x.Condition).HasMaxLength(8).IsRequired();
        alert.Property(x => x.Price).HasPrecision(28, 8);
        alert.HasIndex(x => new { x.Symbol, x.Triggered });
    }
}
