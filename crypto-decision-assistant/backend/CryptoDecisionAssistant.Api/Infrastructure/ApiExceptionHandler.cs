using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace CryptoDecisionAssistant.Api.Infrastructure;

public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var status = exception is ArgumentException ? StatusCodes.Status400BadRequest : StatusCodes.Status502BadGateway;
        if (status >= 500) logger.LogError(exception, "Upstream market/news request failed");
        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = status,
            Title = status == 400 ? "Invalid request" : "Market data is temporarily unavailable",
            Detail = status == 400 ? exception.Message : "تعذر تحديث البيانات الآن. حاول مرة أخرى بعد قليل."
        }, cancellationToken);
        return true;
    }
}
